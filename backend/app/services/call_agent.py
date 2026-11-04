"""The single phone agent: one live-call session and one websocket handler for every call.

The context (see call_context.py) decides what the agent knows and which control tokens it may
use. The session strips every [[TOKEN]] from the audio and acts on the allowed ones:

  [[BOOK_APPOINTMENT doctor_id=..; start=..; name=..; reason=..]]  book a real slot
  [[ESCALATE:id]]                                                  raise an escalation now
  [[APPOINTMENT_REQUESTED]]                                        patient wants a visit (staff arrange)
  [[SWITCH_LANGUAGE_XX]]                                           stripped and logged (not wired up yet)
  [[END_CALL]]                                                     handled by CallSession
"""
import asyncio
import json
import logging
import re
from datetime import datetime
from typing import List, Optional

from fastapi import WebSocket
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.appointment import SOURCE_AGENT
from app.models.call_log import CallLog
from app.models.doctor import Doctor
from app.models.escalation import Escalation
from app.services.audio_utils import decode_twilio_payload
from app.services.call_context import (
    CAP_APPOINTMENT_REQUEST,
    CAP_BOOK,
    CAP_ESCALATE,
    CallContext,
    build_call_context,
)
from app.services.call_finalizer import finalize_call
from app.services.clinic_scheduling import BookingError, book_slot
from app.services.stt_service import DeepgramStream
from app.services.twilio_service import CallSession

logger = logging.getLogger(__name__)
settings = get_settings()

TOKEN_RE = re.compile(r"\[\[\s*([A-Z_]+)(.*?)\]\]", re.DOTALL)
# Every token except END_CALL, which CallSession itself acts on
STRIP_RE = re.compile(r"\[\[(?!END_CALL\]\])[^\]]*\]\]")


class CallAgentSession(CallSession):
    """CallSession that acts on the agent's control tokens, within the call's capabilities."""

    def __init__(self, websocket, call_sid: str, call: CallLog, context: CallContext):
        super().__init__(websocket, call_sid)
        self.call = call
        self.context = context
        self.patient = context.patient
        self._token_buffer = ""
        self._pending_notes: List[str] = []
        self.base_prompt = ""
        # (doctor_id, start_at) -> appointment id, for bookings made during this call
        self.booked: dict = {}
        self._booked_lines: List[str] = []
        self._escalated: set = set()
        self.appointment_requested = False
        self.set_prompt(context.system_prompt)

    def set_prompt(self, prompt: str) -> None:
        """Set the system prompt, keeping a record of bookings already made in this call.

        A barge-in can cancel the agent's reply before it is saved to the conversation history,
        so the booking must also live in the system prompt or the agent may try to book again.
        """
        self.base_prompt = prompt
        if self._booked_lines:
            prompt += (
                "\nALREADY BOOKED DURING THIS CALL (do not book these again; just confirm them if asked):\n"
                + "\n".join(self._booked_lines)
                + "\n"
            )
        self.system_prompt = prompt

    def greeting(self) -> str:
        return self.context.greeting

    async def add_turn(self, role: str, content: str) -> None:
        if role == "assistant" and self._pending_notes:
            content = f"{content} {' '.join(self._pending_notes)}".strip()
            self._pending_notes = []
        await super().add_turn(role, content)

    async def process_agent_sentence(self, sentence: str) -> str:
        # A token can be split across sentences (e.g. if the reason contains "."), so buffer it.
        text = self._token_buffer + (" " if self._token_buffer else "") + sentence
        if "[[" in text and "]]" not in text[text.rfind("[["):]:
            self._token_buffer = text
            return ""
        self._token_buffer = ""

        spoken_extra = ""
        for match in TOKEN_RE.finditer(text):
            extra = await self._handle_token(match.group(1), match.group(2))
            if extra:
                spoken_extra = extra

        spoken = STRIP_RE.sub("", text).strip()
        if spoken_extra:
            spoken = f"{spoken} {spoken_extra}".strip()
        return spoken

    async def _handle_token(self, name: str, arg: str) -> str:
        """Act on one token if this call's context allows it. Returns extra text to speak, if any."""
        caps = self.context.capabilities
        if name == "END_CALL":
            return ""
        if name == "BOOK_APPOINTMENT" and CAP_BOOK in caps:
            return await self._handle_booking(arg)
        if name == "ESCALATE" and CAP_ESCALATE in caps:
            await self._handle_escalation(arg.lstrip(":").strip())
            return ""
        if name == "APPOINTMENT_REQUESTED" and CAP_APPOINTMENT_REQUEST in caps:
            self.appointment_requested = True
            return ""
        if name.startswith("SWITCH_LANGUAGE"):
            logger.info(f"[{self.call_sid}] Language switch requested ({name}); not supported yet")
            return ""
        logger.warning(f"[{self.call_sid}] Ignoring token not allowed in this call: {name}{arg}")
        return ""

    # ---------- Escalation ----------

    async def _handle_escalation(self, criterion: str) -> None:
        criterion = criterion or "red_flag"
        if criterion in self._escalated:
            return
        self._escalated.add(criterion)
        db_case = Escalation(
            call_log_id=self.call.id,
            patient_id=self.call.patient_id,
            reason=f"Red flag raised during call: {criterion.replace('_', ' ')}",
            severity="medium" if criterion == "non_adherence" else "high",
            status="open",
        )
        self.db.add(db_case)
        await self.db.commit()
        logger.info(f"[{self.call_sid}] Escalation #{db_case.id} raised: {criterion}")

    # ---------- Booking ----------

    async def _handle_booking(self, raw: str) -> str:
        """Book the slot. Returns extra text to speak if booking failed."""
        fields = {}
        for part in raw.split(";"):
            if "=" in part:
                key, value = part.split("=", 1)
                fields[key.strip()] = value.strip()

        try:
            doctor_id = int(fields.get("doctor_id", ""))
            start_at = datetime.fromisoformat(fields.get("start", ""))
        except ValueError:
            logger.warning(f"[{self.call_sid}] Malformed booking token: {raw}")
            self._pending_notes.append("[[BOOKING_FAILED: could not read the booking details]]")
            return "Sorry, I couldn't complete that booking. Let me try that again."

        key = (doctor_id, start_at.replace(second=0, microsecond=0))
        if key in self.booked:
            # Same slot re-sent (e.g. after an interrupted reply) — already booked by this call.
            logger.info(f"[{self.call_sid}] Booking already made in this call: appointment #{self.booked[key]}")
            return ""

        try:
            appointment = await book_slot(
                self.db,
                doctor_id=doctor_id,
                start_at=start_at,
                patient_name=fields.get("name") or (self.context.patient_full_name or "Unknown"),
                phone_number=self.call.phone_number,
                reason=fields.get("reason"),
                call_log_id=self.call.id,
                source=SOURCE_AGENT,
                patient_id=self.patient.id if self.patient else None,
                plan_id=self.call.plan_id,
            )
            await self.db.commit()
            logger.info(
                f"[{self.call_sid}] Booked appointment #{appointment.id} doctor={doctor_id} at {start_at}"
            )
            self._pending_notes.append(f"[[BOOKED appointment #{appointment.id}]]")
            self.booked[key] = appointment.id
            doctor = await self.db.get(Doctor, doctor_id)
            self._booked_lines.append(
                f"- Appointment #{appointment.id}: {appointment.patient_name} with "
                f"{doctor.name if doctor else f'doctor {doctor_id}'} on {start_at.strftime('%A %d %b %Y at %I:%M %p')}"
            )
            self.set_prompt(self.base_prompt)
            return ""
        except BookingError as err:
            logger.info(f"[{self.call_sid}] Booking rejected: {err}")
            # Refresh availability so the next reply offers valid slots
            refreshed = await build_call_context(self.db, self.call)
            self.set_prompt(refreshed.system_prompt)
            self._pending_notes.append(f"[[BOOKING_FAILED: {err}]]")
            return "I'm sorry, that slot has just become unavailable. Could I offer you another time?"


async def run_call_stream(websocket: WebSocket, call_sid: str, db: AsyncSession) -> None:
    """Handle the Twilio media-stream websocket for any call, inbound or outbound."""
    await websocket.accept()
    session: Optional[CallAgentSession] = None
    try:
        result = await db.execute(select(CallLog).where(CallLog.call_sid == call_sid))
        call = result.scalar_one_or_none()
        if not call:
            logger.error(f"[{call_sid}] Call not found")
            await websocket.close(code=1008)
            return

        context = await build_call_context(db, call)
        logger.info(f"[{call_sid}] {call.direction} call, capabilities={sorted(context.capabilities)}")
        session = CallAgentSession(websocket, call_sid, call, context)
        session.db = db
        session.selected_digit = "3"  # English

        async def on_transcript(transcript: str, is_final: bool):
            asyncio.create_task(session.handle_transcript(transcript, is_final))

        session.deepgram_stt = DeepgramStream(on_transcript=on_transcript, selected_digit="3")
        try:
            await session.deepgram_stt.start()
            logger.info(f"[{call_sid}] STT client started")
        except Exception as exc:
            logger.error(f"[{call_sid}] Failed to start STT: {exc}")

        while session.is_call_active:
            data = json.loads(await websocket.receive_text())
            event = data.get("event")
            if event == "connected":
                logger.info(f"[{call_sid}] Received connected event")
            elif event == "start":
                session.stream_sid = data["start"]["streamSid"]
                call.stream_sid = session.stream_sid
                logger.info(f"[{call_sid}] Stream started: {session.stream_sid}")
                greeting = session.greeting()
                await session.add_turn("assistant", greeting)
                asyncio.create_task(session.speak(greeting))
            elif event == "media":
                if session.deepgram_stt:
                    await session.deepgram_stt.send_audio(decode_twilio_payload(data["media"]["payload"]))
            elif event == "stop":
                logger.info(f"[{call_sid}] Stream stopped")
                break

    except Exception as exc:
        logger.error(f"[{call_sid}] Call stream error: {exc}", exc_info=True)
    finally:
        if session:
            session.is_call_active = False
            transcript = session.transcript_text
            duration_seconds = int((datetime.utcnow() - session.started_at).total_seconds())
            await session.close()
            try:
                await finalize_call(session.call.id, db, transcript, duration_seconds)
            except Exception as exc:
                logger.error(f"[{call_sid}] Finalize error: {exc}", exc_info=True)
        try:
            await websocket.close()
        except Exception:
            pass
