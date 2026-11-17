"""The agent's context for a call to the clinic: receptionist prompt, opening line, capabilities.

The prompt lists the doctors (with their consultation hours and free slots) and the clinic
knowledge base live from the database, so the agent can only state what the clinic has approved.
"""
from datetime import timedelta
from typing import List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.appointment import ACTIVE_STATUSES, Appointment
from app.models.call_log import CallLog
from app.models.callback_schedule import FOLLOWUP_PENDING, FollowUp
from app.models.knowledge import ClinicKnowledge
from app.models.patient import Patient
from app.prompts.inbound_prompts import (
    BOOKING_RULE_PENDING,
    CALLER_HINT_KNOWN,
    CALLER_HINT_UNKNOWN,
    CONTACT_RULE_KNOWN,
    CONTACT_RULE_UNKNOWN,
    GREETING_KNOWN,
    HUMAN_RULE_REQUEST,
    HUMAN_RULE_TRANSFER,
    OPENING_EN,
    PREVIOUS_CALLS_BLOCK,
    RECEPTIONIST_PROMPT,
    SAVED_LANGUAGE_NOTE,
)
from app.services.agent.context_shared import (
    CAP_APPOINTMENT_REQUEST,
    CAP_CALLBACK,
    CAP_ESCALATE,
    CAP_HUMAN,
    CAP_LANGUAGE,
    CAP_UNANSWERED,
    LANGUAGE_NAMES,
    CallContext,
    last_ten_digits,
    now_text,
    offered_languages,
    one_line,
    recording_line,
    shared_rules,
    spoken_hhmm,
)
from app.services.scheduling.clinic_scheduling import (
    clinic_now,
    format_day,
    get_active_doctors,
    get_free_slots,
    schedule_text,
)
from app.services.voice.telephony import can_transfer

settings = get_settings()

# Days of free slots shown to the agent per doctor (keeps the prompt small)
PROMPT_DAYS_PER_DOCTOR = 3
CATEGORY_LABELS = {"service": "Service", "faq": "FAQ", "policy": "Policy"}

INBOUND_CAPABILITIES = frozenset({CAP_APPOINTMENT_REQUEST, CAP_CALLBACK, CAP_HUMAN, CAP_ESCALATE, CAP_LANGUAGE, CAP_UNANSWERED})


async def _doctor_blocks(db: AsyncSession) -> str:
    doctors = await get_active_doctors(db)
    free = await get_free_slots(db, doctors)
    today = clinic_now().date()
    blocks = []
    for doctor in doctors:
        by_day = {}
        for slot in free.get(doctor.id, []):
            by_day.setdefault(slot.date(), []).append(slot)
        day_lines = [
            f"    - {format_day(day, today)}: {', '.join(s.strftime('%H:%M') for s in by_day[day])}"
            for day in sorted(by_day)[:PROMPT_DAYS_PER_DOCTOR]
        ]
        availability = "\n".join(day_lines) if day_lines else "    - No free slots in the next few days"
        lines = [
            f"* {doctor.name} (doctor_id={doctor.id}), {doctor.specialty}"
            + (f", {doctor.qualification}" if doctor.qualification else ""),
            f"  Consultation hours: {schedule_text(doctor)}; {doctor.slot_minutes}-minute appointments",
            f"  Treats: {doctor.treats or 'not listed'}",
            f"  Consultation fee: {doctor.consultation_fee or 'not listed'}",
        ]
        if doctor.languages:
            lines.append(f"  Speaks: {doctor.languages}")
        lines.append(f"  Free slots:\n{availability}")
        blocks.append("\n".join(lines))
    return "\n".join(blocks) or "* No doctor schedules are set up. Offer a callback from the clinic team."


async def _knowledge_blocks(db: AsyncSession) -> str:
    result = await db.execute(
        select(ClinicKnowledge)
        .where(ClinicKnowledge.is_active == True)  # noqa: E712
        .order_by(ClinicKnowledge.category, ClinicKnowledge.sort_order, ClinicKnowledge.id)
    )
    lines = [
        f"- [{CATEGORY_LABELS.get(item.category, item.category)}] {item.title}: {item.content}"
        for item in result.scalars().all()
    ]
    return "\n".join(lines) or "- Nothing is listed yet."


def _spoken_number(phone_number: str) -> str:
    digits = last_ten_digits(phone_number)
    return f"a number ending in {' '.join(digits[-4:])}" if len(digits) >= 4 else "their phone"


def _greeting_parts(call: CallLog, patient: Optional[Patient] = None) -> Tuple[List[Tuple[str, str]], Optional[str]]:
    """Opening line parts, and the language to start in (None = ask the caller).

    A saved patient is greeted straight away in their saved language; anyone else is asked.
    """
    langs = offered_languages()
    saved = patient.preferred_language if patient else None
    if saved in langs and len(langs) > 1:
        line = GREETING_KNOWN[saved].format(
            org_name=settings.clinic_name, agent_name=settings.clinic_agent_name, recording_line=recording_line(call)
        )
        return [(one_line(line), saved)], saved
    english = OPENING_EN.format(
        org_name=settings.clinic_name,
        agent_name=settings.clinic_agent_name,
        recording_line=recording_line(call),
    )
    if len(langs) == 1:
        # One language only: no need to ask
        english = english.rsplit(" Would you like", 1)[0] + " How may I help you today?"
        return [(one_line(english), langs[0])], langs[0]
    names = {"en": "English", "hi": "Hindi", "te": "Telugu"}
    offered = [names[code] for code in langs]
    question = " or ".join([", ".join(offered[:-1]), offered[-1]]) if len(offered) > 1 else offered[0]
    english = english.replace("English, Hindi or Telugu", question)
    # One question, in English only (the caller answers with the language name)
    parts = [(one_line(english), "en")]
    return parts, None


# How much of a number's history the agent is shown (keeps the prompt small)
HISTORY_CALLS = 3
HISTORY_DAYS = 60


async def _history_block(db: AsyncSession, call: CallLog) -> str:
    """Summaries of earlier calls from the same number, and its open appointment requests / follow-ups."""
    digits = last_ten_digits(call.phone_number)
    if len(digits) < 10:
        return ""
    same_number = CallLog.phone_number.like(f"%{digits}")
    since = call.created_at - timedelta(days=HISTORY_DAYS) if call.created_at else None
    query = (
        select(CallLog)
        .where(same_number, CallLog.id != call.id, CallLog.summary.is_not(None), CallLog.status != "in-progress")
        .order_by(CallLog.id.desc())
        .limit(HISTORY_CALLS)
    )
    if since:
        query = query.where(CallLog.created_at >= since)
    earlier = list((await db.execute(query)).scalars().all())

    offset = timedelta(minutes=settings.clinic_utc_offset_minutes)
    lines = []
    for c in earlier:
        when = ((c.started_at or c.created_at) + offset).strftime("%a %d %b, %I:%M %p")
        who = c.patient_name or "name not given"
        extras = [x for x in (
            f"doctor: {c.doctor_requested}" if c.doctor_requested else "",
            f"preferred: {c.preferred_slot}" if c.preferred_slot else "",
            f"outcome: {c.outcome}" if c.outcome else "",
        ) if x]
        lines.append(f"- {when} ({who}): {c.summary}" + (f" [{'; '.join(extras)}]" if extras else ""))

    appts = (await db.execute(
        select(Appointment)
        .where(Appointment.phone_number.like(f"%{digits}"), Appointment.status.in_(ACTIVE_STATUSES))
        .order_by(Appointment.id.desc())
        .limit(3)
    )).scalars().all()
    tasks = (await db.execute(
        select(FollowUp)
        .where(FollowUp.phone_number.like(f"%{digits}"), FollowUp.status == FOLLOWUP_PENDING, FollowUp.appointment_id.is_(None))
        .order_by(FollowUp.id.desc())
        .limit(3)
    )).scalars().all()
    open_items = []
    for a in appts:
        when = a.start_at.strftime("%a %d %b, %I:%M %p") if a.start_at else (a.preferred_time or "time not set")
        status = "confirmed" if a.status == "confirmed" else "pending clinic confirmation"
        open_items.append(f"- Appointment request #{a.id} for {a.patient_name} with {a.doctor_display_name}, {when} ({status})")
    for t in tasks:
        open_items.append(f"- Waiting for a clinic callback: {t.reason or t.kind.replace('_', ' ')}")

    if not lines and not open_items:
        return ""
    return PREVIOUS_CALLS_BLOCK.format(
        calls="\n".join(lines) or "- (no summaries)",
        open_items="\n".join(open_items) or "- Nothing open",
    )


async def build_inbound_context(db: AsyncSession, call: CallLog, patient: Optional[Patient]) -> CallContext:
    """Someone phoned the clinic number (a real phone, or a test call from the browser)."""
    phone = call.phone_number or ""
    callback_hours = (
        f" between {spoken_hhmm(settings.staff_callback_start)} and {spoken_hhmm(settings.staff_callback_end)}"
    )
    prompt = RECEPTIONIST_PROMPT.format(
        agent_name=settings.clinic_agent_name,
        org_name=settings.clinic_name,
        now=now_text(),
        phone_text=phone or "not available",
        caller_hint=CALLER_HINT_KNOWN.format(name=patient.name) if patient else CALLER_HINT_UNKNOWN,
        history_block=await _history_block(db, call),
        language_note=SAVED_LANGUAGE_NOTE.format(language_name=LANGUAGE_NAMES[patient.preferred_language])
        if patient and patient.preferred_language in LANGUAGE_NAMES and len(offered_languages()) > 1 else "",
        contact_rule=CONTACT_RULE_KNOWN.format(spoken_number=_spoken_number(phone)) if len(last_ten_digits(phone)) >= 10 else CONTACT_RULE_UNKNOWN,
        booking_rule=BOOKING_RULE_PENDING,
        callback_hours=callback_hours,
        human_rule=HUMAN_RULE_TRANSFER if can_transfer(call.call_sid) else HUMAN_RULE_REQUEST.format(callback_hours=callback_hours),
        doctor_blocks=await _doctor_blocks(db),
        knowledge_blocks=await _knowledge_blocks(db),
    )
    parts, language = _greeting_parts(call, patient)
    return CallContext(
        system_prompt=prompt + shared_rules(),
        greeting_parts=parts,
        capabilities=INBOUND_CAPABILITIES,
        patient=patient,
        language=language,
    )
