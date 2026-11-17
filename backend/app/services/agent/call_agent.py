"""The phone agent: one live-call session and one websocket handler for every call.

The context (see call_context.py) decides what the agent knows and which control tokens it may
use. The session strips every [[TOKEN]] from the audio and acts on the allowed ones:

  [[SET_LANGUAGE:en|hi|te]]                                    switch speech recognition and voice
  [[APPOINTMENT_REQUEST name=..; phone=..; doctor_id=..; doctor=..; preferred=..; slot=..; reason=..]]
                                                               record a pending appointment request
  [[CALLBACK_REQUEST name=..; phone=..; doctor=..; preferred=..; reason=..]]
                                                               add a staff follow-up (callback) task
  [[UNANSWERED_QUESTION question=..; name=..; phone=..]]       follow-up: staff answer the question
  [[HUMAN_ASSISTANCE reason=..]]                               follow-up "wants to talk to staff", and a
                                                               live transfer (hold music) when set up
  [[ESCALATE:emergency|distress]]                              urgent follow-up
  [[END_CALL]]                                                 handled by CallSession
"""
import asyncio
import json
import logging
import re
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.appointment import Appointment
from app.models.doctor import Doctor
from app.models.call_log import CallLog
from app.models.callback_schedule import (
    KIND_CALLBACK,
    KIND_DISTRESS,
    KIND_EMERGENCY,
    KIND_HUMAN,
    KIND_UNANSWERED,
    TRANSFER_RINGING,
    FollowUp,
)
from app.services.agent.call_cleanup import close_call_now
from app.services.agent.call_context import (
    CAP_APPOINTMENT_REQUEST,
    CAP_CALLBACK,
    CAP_ESCALATE,
    CAP_HUMAN,
    CAP_LANGUAGE,
    CAP_UNANSWERED,
    CallContext,
    build_call_context,
)
from app.services.agent.call_finalizer import finalize_call
from app.services.agent.context_shared import (
    LANGUAGE_DIGITS,
    LISTEN_BEFORE_CHOICE_DIGIT,
    is_recorded,
)
from app.services.scheduling.appointment_service import record_appointment_request, update_appointment_request
from app.services.scheduling.callback_service import create_follow_up
from app.services.voice.audio_utils import decode_twilio_payload
from app.services.voice.stt_service import DeepgramStream
from app.services.voice.telephony import can_transfer, start_call_recording, transfer_call
from app.services.voice.twilio_service import CallSession

logger = logging.getLogger(__name__)

TOKEN_RE = re.compile(r"\[\[\s*([A-Z_]+)(.*?)\]\]", re.DOTALL)
# Every token except END_CALL, which CallSession itself acts on
STRIP_RE = re.compile(r"\[\[(?!END_CALL\]\])[^\]]*\]\]")

# Said by the system if the live transfer to the front desk fails
TRANSFER_FAILED_LINES = {
    "en": "Sorry, I couldn't connect you right now. Our clinic team will call you back soon. Is there anything else I can help you with?",
    "hi": "माफ़ कीजिए, अभी मैं आपको जोड़ नहीं पाई। हमारी clinic team जल्द ही आपको call करेगी। क्या मैं और कुछ मदद कर सकती हूँ?",
    "te": "క్షమించండి, ఇప్పుడు మిమ్మల్ని కనెక్ట్ చేయలేకపోయాను. మా clinic team త్వరలో మీకు call చేస్తారు. ఇంకా ఏమైనా సహాయం కావాలా?",
}


# Words the model may write instead of a real value; treated as "not given"
PLACEHOLDER_VALUES = {"none", "null", "unknown", "unclear", "unconfirmed", "not given", "not provided", "n/a", "na"}


def parse_fields(raw: str) -> Dict[str, str]:
    """'name=Ravi; phone=caller' -> {'name': 'Ravi', 'phone': 'caller'} (empty values dropped)."""
    fields = {}
    for part in raw.split(";"):
        if "=" in part:
            key, value = part.split("=", 1)
            value = value.strip().rstrip(".")
            if value and value.lower() not in PLACEHOLDER_VALUES:
                fields[key.strip().lower()] = value
    return fields


class CallAgentSession(CallSession):
    """CallSession that acts on the agent's control tokens, within the call's capabilities."""

    def __init__(self, websocket, call_sid: str, call: CallLog, context: CallContext):
        super().__init__(websocket, call_sid)
        self.call = call
        self.call_id = call.id
        self.context = context
        self.patient = context.patient
        self.language: Optional[str] = context.language
        self.selected_digit = LANGUAGE_DIGITS.get(self.language or "en", "3")
        self._token_buffer = ""
        self._pending_notes: List[str] = []
        self._recorded_lines: List[str] = []
        self._escalated: set = set()
        self.appointment: Optional[Appointment] = None
        self.callback: Optional[FollowUp] = None
        self.human_task: Optional[FollowUp] = None
        self._questions: set = set()
        self._transfer_pending = False
        self._stt_switch: Optional[asyncio.Task] = None
        self.base_prompt = context.system_prompt
        self.set_prompt(context.system_prompt)

    # ---------- Prompt ----------

    def set_prompt(self, prompt: str) -> None:
        """Set the system prompt, keeping a record of what was already recorded in this call.

        A barge-in can cancel the agent's reply before it is saved to the history, so this must
        also live in the system prompt or the agent may record the same thing twice.
        """
        self.base_prompt = prompt
        if self._recorded_lines:
            prompt += (
                "\nALREADY RECORDED DURING THIS CALL (do not write these tokens again unless the caller changes "
                "something; then write the token again with the new details and it will be updated):\n"
                + "\n".join(self._recorded_lines)
                + "\n"
            )
        if self.language:
            prompt += f"\nCALL LANGUAGE: the caller chose {self.language}. Speak only in that language.\n"
        self.system_prompt = prompt

    def _remember(self, key: str, line: str) -> None:
        self._recorded_lines = [entry for entry in self._recorded_lines if not entry.startswith(key)] + [f"{key} {line}"]
        self.set_prompt(self.base_prompt)

    # ---------- Session hooks ----------

    async def add_turn(self, role: str, content: str, persist: bool = True, at: Optional[datetime] = None) -> None:
        if role == "assistant" and self._pending_notes:
            content = f"{content} {' '.join(self._pending_notes)}".strip()
            self._pending_notes = []
        await super().add_turn(role, content, persist=persist, at=at)

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
        # A token can be split across sentences (e.g. if a value contains "."), so buffer it.
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

    async def on_reply_done(self, completed: bool) -> None:
        """After a reply: put the caller on hold and ring the front desk if the agent just said it would.

        What happens next (staff pick up, or the busy message) is handled by Twilio callbacks in
        routers/clinic_twilio.py; the agent's part of the call ends here.
        """
        if not (self._transfer_pending and completed and self.is_call_active):
            return
        self._transfer_pending = False
        await asyncio.sleep(max(0.0, self._play_until - self._now()) + 0.3)
        task = self.human_task
        started = task is not None and await transfer_call(
            self.call_sid, task.id, self.language or "en", task.patient_name, task.reason
        )
        if started:
            self.call.status = "transferred"
            self._pending_notes.append("[[TRANSFERRING: caller on hold while the front desk rings]]")
            await self.add_turn("assistant", "")
            await self.db.commit()
            self.is_call_active = False
        else:
            if task:
                task.transfer_status = None
                await self.db.commit()
            line = TRANSFER_FAILED_LINES.get(self.language or "en", TRANSFER_FAILED_LINES["en"])
            self._pending_notes.append("[[TRANSFER_FAILED: the request is on the clinic team's follow-up list]]")
            await self.add_turn("assistant", line)
            await self.speak(line)

    async def on_auto_end(self, reason: str) -> None:
        """The call was ended because it ran too long: leave a callback for staff (silence needs none)."""
        if reason != "max_duration":
            return
        await self._new_follow_up(
            KIND_CALLBACK, {}, f"Call ended automatically after {get_settings().max_call_minutes} minutes; check if the caller still needs help"
        )

    async def _handle_token(self, name: str, arg: str) -> str:
        """Act on one token if this call's context allows it. Returns extra text to speak, if any."""
        caps = self.context.capabilities
        if name == "END_CALL":
            return ""
        try:
            if name == "SET_LANGUAGE" and CAP_LANGUAGE in caps:
                await self._set_language(arg.lstrip(":").strip().lower())
                return ""
            if name == "APPOINTMENT_REQUEST" and CAP_APPOINTMENT_REQUEST in caps:
                await self._handle_appointment(parse_fields(arg))
                return ""
            if name == "CALLBACK_REQUEST" and CAP_CALLBACK in caps:
                await self._handle_callback(parse_fields(arg))
                return ""
            if name == "UNANSWERED_QUESTION" and CAP_UNANSWERED in caps:
                await self._handle_unanswered(parse_fields(arg))
                return ""
            if name == "HUMAN_ASSISTANCE" and CAP_HUMAN in caps:
                await self._handle_human(parse_fields(arg))
                return ""
            if name == "ESCALATE" and CAP_ESCALATE in caps:
                await self._handle_escalation(arg.lstrip(":").strip().lower())
                return ""
        except Exception as exc:
            logger.error(f"[{self.call_sid}] Token {name} failed: {exc}", exc_info=True)
            await self._recover()
            self._pending_notes.append(f"[[SYSTEM_ERROR: {name} could not be saved; the clinic team will call the caller back]]")
            return ""
        logger.warning(f"[{self.call_sid}] Ignoring token not allowed in this call: {name}{arg}")
        return ""

    async def _recover(self) -> None:
        """Undo a failed step and reload the call, so the rest of the call keeps working and saving."""
        try:
            await self.db.rollback()
            await self.db.refresh(self.call)
            if self.patient is not None:
                await self.db.refresh(self.patient)
        except Exception as exc:
            logger.error(f"[{self.call_sid}] Could not recover after a failed step: {exc}", exc_info=True)

    # ---------- Language ----------

    async def _set_language(self, language: str) -> None:
        if language not in LANGUAGE_DIGITS or language == self.language:
            return
        logger.info(f"[{self.call_sid}] Language set to {language}")
        self.language = language
        self.selected_digit = LANGUAGE_DIGITS[language]
        self.call.language = language
        await self.db.commit()
        self.set_prompt(self.base_prompt)
        self.sarvam_tts.prewarm(self.selected_digit)
        # Reconnect speech recognition for the new language without blocking the reply
        if self._stt_switch and not self._stt_switch.done():
            self._stt_switch.cancel()
        self._stt_switch = asyncio.create_task(self._switch_stt(self.selected_digit))

    async def _switch_stt(self, digit: str) -> None:
        old = self.deepgram_stt
        if old and old.selected_digit == digit:
            return
        new = DeepgramStream(on_transcript=old.on_transcript if old else None, selected_digit=digit)
        try:
            await new.start()
        except Exception as exc:
            logger.error(f"[{self.call_sid}] Could not switch speech recognition: {exc}")
            return
        if not self.is_call_active:
            await new.stop()
            return
        self.deepgram_stt = new
        if old:
            await old.stop()
        logger.info(f"[{self.call_sid}] Speech recognition switched (digit {digit})")

    # ---------- Records ----------

    def _phone(self, fields: Dict[str, str]) -> Optional[str]:
        value = fields.get("phone", "")
        digits = re.sub(r"\D", "", value)
        if value.lower() == "caller" or len(digits) < 10:
            return self.call.phone_number or (digits or None)
        if len(digits) == 10:
            return f"+91{digits}"
        return f"+{digits}"

    def _name(self, fields: Dict[str, str]) -> str:
        return fields.get("name") or (self.patient.name if self.patient else "") or self.call.patient_name or "Unknown"

    async def _handle_appointment(self, fields: Dict[str, str]) -> None:
        slot = None
        if fields.get("slot"):
            try:
                slot = datetime.fromisoformat(fields["slot"])
            except ValueError:
                logger.warning(f"[{self.call_sid}] Unreadable slot in appointment request: {fields['slot']}")
        doctor_id = int(fields["doctor_id"]) if fields.get("doctor_id", "").isdigit() else None
        details = dict(
            patient_name=self._name(fields),
            phone_number=self._phone(fields),
            doctor_requested=fields.get("doctor"),
            doctor_id=doctor_id,
            preferred_time=fields.get("preferred"),
            slot=slot,
            reason=fields.get("reason"),
        )
        if self.appointment is None:
            outcome = await record_appointment_request(
                self.db, call_log_id=self.call_id, patient_id=self.patient.id if self.patient else None, **details
            )
        else:
            outcome = await update_appointment_request(self.db, self.appointment, **details)
        await self.db.commit()
        self.appointment = outcome.appointment
        appointment = outcome.appointment
        status = "confirmed by the clinic system" if outcome.confirmed else "pending clinic confirmation"
        logger.info(f"[{self.call_sid}] Appointment request #{appointment.id} recorded ({appointment.status})")
        note = f"[[APPOINTMENT_RECORDED #{appointment.id}: {status}]]"
        if outcome.slot_problem:
            note = f"[[APPOINTMENT_RECORDED #{appointment.id}: {status}; the requested slot was not used ({outcome.slot_problem}), the clinic team will arrange the time]]"
        self._pending_notes.append(note)
        when = appointment.start_at.strftime("%A %d %b %Y at %H:%M") if appointment.start_at else (appointment.preferred_time or "time not given")
        self._remember(
            "APPOINTMENT_REQUEST:",
            f"#{appointment.id} for {appointment.patient_name} with {await self._doctor_name(appointment)}, {when} ({status})",
        )

    async def _doctor_name(self, appointment: Appointment) -> str:
        if appointment.doctor_id:
            doctor = await self.db.get(Doctor, appointment.doctor_id)
            if doctor:
                return doctor.name
        return appointment.doctor_requested or "a doctor to be chosen"

    async def _handle_callback(self, fields: Dict[str, str]) -> None:
        if self.callback is None:
            self.callback = await create_follow_up(
                self.db,
                kind=KIND_CALLBACK,
                call_log_id=self.call_id,
                patient_id=self.patient.id if self.patient else None,
                patient_name=self._name(fields),
                phone_number=self._phone(fields),
                doctor_requested=fields.get("doctor"),
                preferred_time=fields.get("preferred"),
                reason=fields.get("reason"),
            )
        else:
            task = self.callback
            task.patient_name = self._name(fields)
            task.phone_number = self._phone(fields)
            task.doctor_requested = fields.get("doctor") or task.doctor_requested
            task.preferred_time = fields.get("preferred") or task.preferred_time
            task.reason = fields.get("reason") or task.reason
        await self.db.commit()
        logger.info(f"[{self.call_sid}] Callback task #{self.callback.id} recorded")
        self._pending_notes.append(f"[[CALLBACK_RECORDED #{self.callback.id}]]")
        self._remember("CALLBACK_REQUEST:", f"#{self.callback.id} for {self.callback.patient_name}")

    async def _new_follow_up(self, kind: str, fields: Dict[str, str], reason: str, priority: Optional[str] = None) -> FollowUp:
        task = await create_follow_up(
            self.db,
            kind=kind,
            priority=priority,
            call_log_id=self.call_id,
            patient_id=self.patient.id if self.patient else None,
            patient_name=fields.get("name") or self.call.patient_name or (self.patient.name if self.patient else None),
            phone_number=self._phone(fields),
            reason=reason,
        )
        await self.db.commit()
        logger.info(f"[{self.call_sid}] Follow-up #{task.id} ({kind}) recorded")
        return task

    async def _handle_human(self, fields: Dict[str, str]) -> None:
        if self.human_task is not None:
            return
        reason = fields.get("reason") or "Wants to talk to clinic staff"
        self.human_task = await self._new_follow_up(KIND_HUMAN, fields, reason)
        if can_transfer(self.call_sid):
            self.human_task.transfer_status = TRANSFER_RINGING
            await self.db.commit()
            self._transfer_pending = True
        self._remember("HUMAN_ASSISTANCE:", f"follow-up #{self.human_task.id} recorded")

    async def _handle_unanswered(self, fields: Dict[str, str]) -> None:
        question = fields.get("question") or fields.get("reason") or "A question the agent could not answer"
        if question.lower() in self._questions:
            return
        self._questions.add(question.lower())
        task = await self._new_follow_up(KIND_UNANSWERED, fields, question)
        self._pending_notes.append(f"[[QUESTION_RECORDED #{task.id}]]")
        self._remember(f"UNANSWERED_QUESTION {len(self._questions)}:", f"follow-up #{task.id}: {question}")

    async def _handle_escalation(self, kind: str) -> None:
        kind = KIND_DISTRESS if kind == "distress" else KIND_EMERGENCY
        if kind in self._escalated:
            return
        self._escalated.add(kind)
        reason = "Caller described a possible emergency" if kind == KIND_EMERGENCY else "Caller sounded in emotional distress"
        await self._new_follow_up(kind, {}, reason)


async def run_call_stream(websocket: WebSocket, call_sid: str, db: AsyncSession, accept: bool = True) -> None:
    """Handle the media-stream websocket for a call.

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
        logger.info(f"[{call_sid}] Call started, capabilities={sorted(context.capabilities)}")
        session = CallAgentSession(websocket, call_sid, call, context)
        session.db = db
        if context.language:
            call.language = context.language
        first_part_digit = LANGUAGE_DIGITS.get(context.greeting_parts[0][1], "3")
        session.sarvam_tts.prewarm(first_part_digit)  # voice connection ready for the greeting

        async def on_transcript(transcript: str, is_final: bool):
            asyncio.create_task(session.handle_transcript(transcript, is_final))

        # Until the caller picks a language, listen with the multilingual model
        listen_digit = LANGUAGE_DIGITS[context.language] if context.language else LISTEN_BEFORE_CHOICE_DIGIT
        session.deepgram_stt = DeepgramStream(on_transcript=on_transcript, selected_digit=listen_digit)

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
                if is_recorded(call):
                    asyncio.create_task(start_call_recording(call.call_sid))
                await session.add_turn("assistant", context.greeting)
                asyncio.create_task(session.speak_parts(
                    [(text, LANGUAGE_DIGITS.get(lang, "3")) for text, lang in context.greeting_parts]
                ))
                # From now on: "Are you still there?" after silence, and a maximum call length
                session.start_watchdog()
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
            if session._stt_switch and not session._stt_switch.done():
                session._stt_switch.cancel()
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
