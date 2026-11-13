"""The single phone agent: one live-call session and one websocket handler for every call.

The context (see call_context.py) decides what the agent knows and which control tokens it may
use. The session strips every [[TOKEN]] from the audio and acts on the allowed ones:

  [[BOOK_APPOINTMENT doctor_id=..; start=..; name=..; reason=..]]  book a real slot
  [[ESCALATE:id]]                                                  raise an escalation now
  [[APPOINTMENT_REQUESTED]]                                        patient wants a visit (staff arrange)
  [[SCHEDULE_CALLBACK when=..; reason=..]]                         caller asked to be called back
  [[SWITCH_LANGUAGE_XX]]                                           stripped and logged (not wired up yet)
  [[END_CALL]]                                                     handled by CallSession
"""
import asyncio
import json
import logging
import re
from datetime import datetime
from typing import List, Optional

from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.appointment import SOURCE_AGENT
from app.models.call_log import DIRECTION_OUTBOUND, CallLog
from app.models.doctor import Doctor
from app.models.escalation import Escalation
from app.services.voice.audio_utils import decode_twilio_payload
from app.services.agent.call_context import (
    CAP_APPOINTMENT_REQUEST,
    CAP_BOOK,
    CAP_CALLBACK,
    CAP_ESCALATE,
    CallContext,
    build_call_context,
)
from app.services.agent.context_shared import is_recorded
from app.services.agent.call_finalizer import finalize_call
from app.services.agent.call_cleanup import close_call_now
from app.services.scheduling.callback_service import (
    parse_callback_time,
    schedule_requested_callback,
    start_call_recording,
    within_calling_hours,
)
from app.services.scheduling.clinic_scheduling import BookingError, book_slot
from app.services.voice.stt_service import DeepgramStream
from app.services.voice.twilio_service import CallSession

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

    async def add_turn(self, role: str, content: str, persist: bool = True) -> None:
        if role == "assistant" and self._pending_notes:
            content = f"{content} {' '.join(self._pending_notes)}".strip()
            self._pending_notes = []
        await super().add_turn(role, content, persist=persist)

    def on_new_turn(self) -> None:
        # A token left unfinished by an interrupted reply must not swallow the next reply's speech
        self._token_buffer = ""

    async def flush_agent_text(self) -> str:
        """End of a reply: speak any text held back waiting for a token that never closed."""
        text, self._token_buffer = self._token_buffer, ""
        if not text:
            return ""
        if "[[" in text and "]]" not in text[text.rfind("[["):]:
            logger.warning(f"[{self.call_sid}] Dropping unfinished token: {text[text.rfind('[['):][:80]}")
            text = text[: text.rfind("[[")]
        return STRIP_RE.sub("", text).replace("[[END_CALL]]", "").strip()

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
        if name == "SCHEDULE_CALLBACK" and CAP_CALLBACK in caps:
            return await self._handle_callback(arg)
        if name.startswith("SWITCH_LANGUAGE"):
            logger.info(f"[{self.call_sid}] Language switch requested ({name}); not supported yet")
            return ""
        logger.warning(f"[{self.call_sid}] Ignoring token not allowed in this call: {name}{arg}")
        return ""

    # ---------- Escalation ----------

    def _escalation_severity(self, criterion: str) -> str:
        """Severity from the red flag's own protocol entry (urgent / high), else a safe default."""
        if criterion == "emotional_distress":
            return "urgent"
        protocol = self.context.plan.protocol if self.context.plan else None
        for flag in (protocol.red_flag_criteria if protocol else None) or []:
            if (flag.get("id") or flag.get("criterion_id")) == criterion:
                severity = str(flag.get("severity") or "").lower()
                return severity if severity in ("urgent", "high") else "medium"
        return "medium" if criterion == "non_adherence" else "high"

    async def _handle_escalation(self, criterion: str) -> None:
        criterion = criterion or "red_flag"
        if criterion in self._escalated:
            return
        self._escalated.add(criterion)
        db_case = Escalation(
            call_log_id=self.call.id,
            patient_id=self.call.patient_id,
            reason=f"Red flag raised during call: {criterion.replace('_', ' ')}",
            severity=self._escalation_severity(criterion),
            status="open",
        )
        self.db.add(db_case)
        await self.db.commit()
        logger.info(f"[{self.call_sid}] Escalation #{db_case.id} raised: {criterion}")

    # ---------- Callback ----------

    async def _handle_callback(self, raw: str) -> str:
        """Schedule (or move) the callback the caller asked for. Returns extra text to speak if it failed."""
        fields = {}
        for part in raw.split(";"):
            if "=" in part:
                key, value = part.split("=", 1)
                fields[key.strip()] = value.strip()
        when_raw = (fields.get("when") or "").strip()
        when = parse_callback_time(when_raw)

        # A time was given but can't be used: tell the agent so it asks again (never silently move it)
        problem = None
        if when_raw and when is None:
            problem = f"{when_raw} is not a valid future date and time"
        elif when is not None and not within_calling_hours(when):
            problem = f"{when_raw} is outside calling hours"
        if problem:
            logger.info(f"[{self.call_sid}] Callback not saved: {problem}")
            self._pending_notes.append(f"[[CALLBACK_FAILED: {problem}]]")
            return "Sorry, I couldn't save that time. Could you tell me the day and time again?"

        try:
            callback = await schedule_requested_callback(
                self.db,
                self.call,
                when,
                reason=fields.get("reason") or None,
                patient_name=self.context.patient_full_name,
            )
            await self.db.commit()
        except Exception as exc:
            logger.error(f"[{self.call_sid}] Callback could not be saved: {exc}", exc_info=True)
            await self.db.rollback()
            self._pending_notes.append("[[CALLBACK_FAILED: the system could not save it]]")
            return "Sorry, I couldn't save that just now. The clinic team will call you back."
        when = callback.scheduled_time
        logger.info(f"[{self.call_sid}] Callback #{callback.id} scheduled for {when}")
        self._pending_notes.append(
            f"[[CALLBACK_SCHEDULED #{callback.id} for {when.strftime('%A %d %b %Y at %I:%M %p')}]]"
        )
        return ""

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


async def run_call_stream(websocket: WebSocket, call_sid: str, db: AsyncSession, accept: bool = True) -> None:
    """Handle the media-stream websocket for any call, inbound or outbound.

    Twilio sends its Media Streams protocol (connected / start / media / stop). The direct browser
    test (routers/sim_call.py) speaks the same protocol, already accepted, so it passes accept=False.
    """
    if accept:
        await websocket.accept()
    session: Optional[CallAgentSession] = None
    stt_task: Optional[asyncio.Task] = None
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
        session.sarvam_tts.prewarm(session.selected_digit)  # voice connection ready for the greeting

        async def on_transcript(transcript: str, is_final: bool):
            asyncio.create_task(session.handle_transcript(transcript, is_final))

        session.deepgram_stt = DeepgramStream(on_transcript=on_transcript, selected_digit="3")

        async def start_stt():
            try:
                await session.deepgram_stt.start()
                logger.info(f"[{call_sid}] STT client started")
            except Exception as exc:
                logger.error(f"[{call_sid}] Failed to start STT: {exc}")

        # Connect STT in the background so the greeting isn't held up by it
        stt_task = asyncio.create_task(start_stt())

        while session.is_call_active:
            try:
                # Wake up at least once a second so a call the agent has ended (goodbye) stops promptly
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            data = json.loads(raw)
            event = data.get("event")
            if event == "connected":
                logger.info(f"[{call_sid}] Received connected event")
            elif event == "start":
                session.stream_sid = data["start"]["streamSid"]
                call.stream_sid = session.stream_sid
                logger.info(f"[{call_sid}] Stream started: {session.stream_sid}")
                if call.direction != DIRECTION_OUTBOUND and is_recorded(call):
                    # Outbound calls record from dialling; an inbound call can only start once connected
                    asyncio.create_task(start_call_recording(call.call_sid))
                greeting = session.greeting()
                await session.add_turn("assistant", greeting)
                asyncio.create_task(session.speak(greeting))
            elif event == "media":
                if session.deepgram_stt:
                    await session.deepgram_stt.send_audio(decode_twilio_payload(data["media"]["payload"]))
            elif event == "stop":
                logger.info(f"[{call_sid}] Stream stopped")
                break

    except WebSocketDisconnect:
        # The caller hung up (or the browser tab closed) without a "stop" event: a normal end
        logger.info(f"[{call_sid}] Media stream disconnected")
    except Exception as exc:
        logger.error(f"[{call_sid}] Call stream error: {exc}", exc_info=True)
    finally:
        if session:
            session.is_call_active = False
            if stt_task and not stt_task.done():
                stt_task.cancel()
            transcript = session.transcript_text
            duration_seconds = int((datetime.utcnow() - session.started_at).total_seconds())
            await session.close()
            try:
                await finalize_call(session.call.id, db, transcript, duration_seconds)
            except Exception as exc:
                logger.error(f"[{call_sid}] Finalize error: {exc}", exc_info=True)
                # Never leave the call looking live because the summary step failed
                await close_call_now(db, call_id=session.call.id)
        else:
            # Setup failed before the session existed: close the call record anyway
            await close_call_now(db, call_sid=call_sid)
        try:
            await websocket.close()
        except Exception:
            pass
