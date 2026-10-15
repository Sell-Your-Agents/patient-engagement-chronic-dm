"""Missed-call callback agent: prompt, live call session and post-call finalization."""
import json
import logging
import re
from datetime import datetime, timedelta
from typing import List, Optional

import anthropic
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.clinic import ClinicCall, ClinicCallTurn, ClinicAppointment, ClinicDoctor, MissedCall
from app.services.claude_service import client as claude_client
from app.services.clinic_scheduling import (
    BookingError,
    book_slot,
    clinic_now,
    format_day,
    format_slot,
    get_active_doctors,
    get_free_slots,
)
from app.services.twilio_service import CallSession

logger = logging.getLogger(__name__)
settings = get_settings()

# Days of availability shown to the agent per doctor (keeps the prompt small)
PROMPT_DAYS_PER_DOCTOR = 3

BOOK_TOKEN_RE = re.compile(r"\[\[BOOK_APPOINTMENT(.*?)\]\]", re.DOTALL)
ANY_TOKEN_RE = re.compile(r"\[\[(?!END_CALL\]\])[^\]]*\]\]")


async def build_clinic_prompt(db: AsyncSession, missed_call: MissedCall) -> str:
    doctors = await get_active_doctors(db)
    free = await get_free_slots(db, doctors)
    now = clinic_now()

    doctor_blocks = []
    for doctor in doctors:
        by_day = {}
        for slot in free.get(doctor.id, []):
            by_day.setdefault(slot.date(), []).append(slot)
        day_lines = []
        for day in sorted(by_day)[:PROMPT_DAYS_PER_DOCTOR]:
            times = ", ".join(s.strftime("%H:%M") for s in by_day[day])
            day_lines.append(f"    - {format_day(day, now.date())}: {times}")
        availability = "\n".join(day_lines) if day_lines else "    - No free slots in the next few days"
        doctor_blocks.append(
            f"* {doctor.name} (doctor_id={doctor.id}) — {doctor.specialty}, {doctor.slot_minutes}-minute appointments\n"
            f"  Treats: {doctor.treats}\n"
            f"  Free slots (24h clock):\n{availability}"
        )

    caller_hint = (
        f"The caller's name on record is {missed_call.caller_name}; confirm it."
        if missed_call.caller_name
        else "You do not know the caller's name yet."
    )

    return f"""You are {settings.clinic_agent_name}, a warm and professional receptionist calling on behalf of {settings.clinic_name}.
You are on a live PHONE call. This person called the clinic earlier ({missed_call.missed_at.strftime('%d %b %Y at %I:%M %p')}) but nobody could answer, so you are calling them back.
Current clinic date/time: {now.strftime('%A %d %b %Y, %I:%M %p')}.
Caller phone: {missed_call.phone_number}. {caller_hint}

YOUR GOAL
1. Apologise briefly for missing their call and ask how the clinic can help.
2. Understand why they called: their main problem or symptoms, since when, and whether it is for themselves or someone else.
3. Ask for the patient's full name.
4. Choose the most suitable doctor from the list below based on the problem. Use the General Physician for general or unclear issues, fever, and routine BP or sugar check-ups.
5. Offer two or three of that doctor's free slots (prefer the earliest ones) and let the caller choose. Never offer a time that is not in the list.
6. Once the caller clearly agrees to a specific doctor and time, book it by writing the booking token (see below), then confirm the doctor's name, day, date and time back to them.
7. Ask if there is anything else. Then thank them, say goodbye and end the call.

If the caller only had a question (timings, location, fees), answer what you can, offer an appointment, and do not force a booking.
If they do not want an appointment, politely close the call.

EMERGENCY SAFETY
If the caller describes severe chest pain, difficulty breathing, signs of stroke (face drooping, arm weakness, slurred speech), heavy bleeding, unconsciousness or a serious injury, tell them clearly to call 108 or go to the nearest emergency room immediately. You may still offer a follow-up appointment.
Never diagnose or prescribe medicines.

DOCTORS AND AVAILABILITY
{chr(10).join(doctor_blocks)}

BOOKING TOKEN
When the caller agrees to a slot, include exactly one token like this in your reply:
[[BOOK_APPOINTMENT doctor_id=1; start=2026-10-16T09:15; name=Ravi Kumar; reason=fever and body pain for 3 days]]
- start must be the slot's date (YYYY-MM-DD) and 24h time from the list above.
- name: the patient's full name only, no titles. reason: a short plain phrase without full stops.
- The token is invisible to the caller; the system books the slot. If the slot turns out to be unavailable you will be told, so then offer another time.
- Only book once per appointment. Never write the token before the caller has agreed.

ENDING THE CALL
When the conversation is finished and you have said goodbye, add [[END_CALL]] at the very end of your final reply.

SPEAKING STYLE
- Speak naturally in English, like a friendly receptionist. Keep each reply to one to three short sentences.
- Ask one question at a time. No lists, no markdown, no emojis.
- When speaking, say "Doctor" instead of the abbreviation "Dr." (e.g. "Doctor Ananya Rao").
- Say times like "nine fifteen in the morning" or "9:15 AM", and dates like "Thursday, 16th October".
"""


class ClinicCallSession(CallSession):
    """CallSession that books clinic appointments from agent tokens and stores turns."""

    def __init__(self, websocket, call_sid: str, clinic_call: ClinicCall, missed_call: MissedCall):
        super().__init__(websocket, call_sid)
        self.clinic_call = clinic_call
        self.missed_call = missed_call
        self._token_buffer = ""
        self._pending_notes: List[str] = []
        self.base_prompt = ""
        # (doctor_id, start_at) -> appointment id, for bookings made during this call
        self.booked: dict = {}
        self._booked_lines: List[str] = []

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

    async def add_turn(self, role: str, content: str) -> None:
        if role == "assistant" and self._pending_notes:
            content = f"{content} {' '.join(self._pending_notes)}".strip()
            self._pending_notes = []
        self.conversation_history.append({"role": role, "content": content})
        self.transcript_text += f"{role.upper()}: {content}\n"
        if self.db:
            self.db.add(
                ClinicCallTurn(
                    clinic_call_id=self.clinic_call.id,
                    role=role,
                    content=content,
                    timestamp=datetime.utcnow(),
                )
            )
            await self.db.flush()

    async def process_agent_sentence(self, sentence: str) -> str:
        # A token can be split across sentences (e.g. if the reason contains "."), so buffer it.
        text = self._token_buffer + (" " if self._token_buffer else "") + sentence
        if "[[" in text and "]]" not in text[text.rfind("[["):]:
            self._token_buffer = text
            return ""
        self._token_buffer = ""

        spoken_extra = ""
        for match in BOOK_TOKEN_RE.finditer(text):
            spoken_extra = await self._handle_booking(match.group(1))

        spoken = ANY_TOKEN_RE.sub("", text).strip()
        if spoken_extra:
            spoken = f"{spoken} {spoken_extra}".strip()
        return spoken

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
                patient_name=fields.get("name") or self.missed_call.caller_name or "Unknown",
                phone_number=self.missed_call.phone_number,
                reason=fields.get("reason"),
                missed_call_id=self.missed_call.id,
                clinic_call_id=self.clinic_call.id,
            )
            await self.db.commit()
            logger.info(
                f"[{self.call_sid}] Booked appointment #{appointment.id} doctor={doctor_id} at {start_at}"
            )
            self._pending_notes.append(f"[[BOOKED appointment #{appointment.id}]]")
            self.booked[key] = appointment.id
            doctor = await self.db.get(ClinicDoctor, doctor_id)
            self._booked_lines.append(
                f"- Appointment #{appointment.id}: {appointment.patient_name} with "
                f"{doctor.name if doctor else f'doctor {doctor_id}'} on {start_at.strftime('%A %d %b %Y at %I:%M %p')}"
            )
            self.set_prompt(self.base_prompt)
            return ""
        except BookingError as err:
            logger.info(f"[{self.call_sid}] Booking rejected: {err}")
            # Refresh availability so the next reply offers valid slots
            self.set_prompt(await build_clinic_prompt(self.db, self.missed_call))
            self._pending_notes.append(f"[[BOOKING_FAILED: {err}]]")
            return "I'm sorry, that slot has just become unavailable. Could I offer you another time?"

    def greeting(self) -> str:
        return (
            f"Hello, this is {settings.clinic_agent_name} calling from {settings.clinic_name}. "
            "We noticed you tried to call us earlier and we couldn't answer, I'm sorry about that. "
            "How can we help you today?"
        )


def _extract_json(text: str) -> dict:
    if "```json" in text:
        text = text.split("```json")[1].split("```")[0]
    elif "```" in text:
        text = text.split("```")[1].split("```")[0]
    return json.loads(text.strip())


async def summarize_clinic_call(transcript: str) -> dict:
    prompt = f"""You are reviewing a phone call where a clinic receptionist called back someone who had missed-called the clinic.

TRANSCRIPT:
{transcript}

Return only a JSON object with these fields:
{{
  "patient_name": "full name of the patient, or null",
  "reason": "short phrase describing why they called / their problem, or null",
  "symptoms": ["list", "of", "symptoms"],
  "urgency": "routine|soon|urgent|emergency",
  "outcome": "booked|declined|info_only|call_later|wrong_number|no_conversation",
  "summary": "2-3 sentence summary of the call"
}}"""
    try:
        response = claude_client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}],
        )
        return _extract_json(response.content[0].text)
    except (json.JSONDecodeError, anthropic.APIError, IndexError) as err:
        logger.error(f"Clinic call summary failed: {err}")
        return {}


async def finalize_clinic_call(db: AsyncSession, clinic_call_id: int, transcript: str) -> None:
    call = await db.get(ClinicCall, clinic_call_id)
    if not call:
        return
    missed_call = await db.get(MissedCall, call.missed_call_id)

    call.transcript = transcript or call.transcript
    call.ended_at = call.ended_at or datetime.utcnow()
    if call.started_at:
        call.duration_seconds = int((call.ended_at - call.started_at).total_seconds())
    call.status = "completed"

    result = await db.execute(
        select(ClinicAppointment).where(ClinicAppointment.clinic_call_id == clinic_call_id)
    )
    appointments = list(result.scalars().all())

    summary = await summarize_clinic_call(transcript) if transcript.strip() else {}
    call.structured_summary = summary or None
    call.patient_name = summary.get("patient_name") or (appointments[0].patient_name if appointments else None)
    call.reason = summary.get("reason") or (appointments[0].reason if appointments else None)
    call.urgency = summary.get("urgency")
    call.summary = summary.get("summary")
    call.outcome = "booked" if appointments else (summary.get("outcome") or "no_conversation")

    # Fill gaps on appointments booked during the call
    for appointment in appointments:
        if call.patient_name and appointment.patient_name in ("", "Unknown"):
            appointment.patient_name = call.patient_name
        if call.reason and not appointment.reason:
            appointment.reason = call.reason

    if missed_call:
        missed_call.status = "booked" if appointments else "no_booking"
        if call.patient_name and not missed_call.caller_name:
            missed_call.caller_name = call.patient_name

    await db.commit()
    logger.info(f"Finalized clinic call #{clinic_call_id}: outcome={call.outcome}")
