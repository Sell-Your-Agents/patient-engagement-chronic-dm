"""What the single phone agent knows and is allowed to do on a given call.

One agent (settings.clinic_agent_name) handles every call. The call's direction and the caller
decide the context:

- outbound            -> health-coaching check-in built from the patient's disease protocol
- inbound             -> receptionist: picks a doctor and books a slot
- inbound + patient   -> receptionist that also knows the patient's care plan and red flags
- outbound callback   -> calling back someone who asked for it: resumes the check-in if that is
                         what they were on, otherwise the receptionist

All prompt text lives in app/prompts/prompts.py; this module only fills it in (coaching content
never leaks into the receptionist prompt for strangers). The capabilities set decides which
control tokens the session will act on.
"""
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import List, Optional, Sequence

from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.config import get_settings
from app.models.call_log import CallLog, CallTurn, DIRECTION_OUTBOUND
from app.models.callback_schedule import CallbackSchedule, SCHEDULE_TYPE_STAFF
from app.models.plan import Plan
from app.models.condition import PatientCondition
from app.models.patient import Patient
from app.services.scheduling.clinic_scheduling import (
    clinic_now,
    format_day,
    get_active_doctors,
    get_free_slots,
)
from app.services.scheduling.callback_service import find_callback_for_call, find_source_call
from app.prompts.chronic_prompt import build_system_prompt
from app.prompts.prompts import (
    CALLBACK_CHECKIN_GREETING,
    CALLBACK_GREETING,
    CALLBACK_INSTRUCTIONS,
    CALLBACK_NOTE,
    CALLER_HINT_CALLBACK_UNKNOWN,
    CALLER_HINT_NAMED,
    CALLER_HINT_PATIENT,
    CALLER_HINT_UNKNOWN,
    CARE_PLAN_BLOCK,
    CHECKIN_GREETING,
    CHRONIC_FALLBACK_PROMPT,
    ESCALATION_TOKEN_BLOCK,
    LIVE_CALL_SITUATION,
    PREVIOUS_CONVERSATIONS,
    RECEPTIONIST_GREETING,
    RECEPTIONIST_PROMPT,
)

logger = logging.getLogger(__name__)
settings = get_settings()

# Control-token capabilities
CAP_BOOK = "book"  # [[BOOK_APPOINTMENT ...]] books a real slot
CAP_ESCALATE = "escalate"  # [[ESCALATE:id]] raises an escalation case right away
CAP_APPOINTMENT_REQUEST = "appointment_request"  # [[APPOINTMENT_REQUESTED]] (staff arrange the time)
CAP_CALLBACK = "callback"  # [[SCHEDULE_CALLBACK ...]] caller asked us to call them back

# Days of availability shown to the agent per doctor (keeps the prompt small)
PROMPT_DAYS_PER_DOCTOR = 3

# Earlier calls a callback remembers (follows callback-of-a-callback chains), and how much of each
HISTORY_MAX_CALLS = 3
HISTORY_MAX_CHARS_PER_CALL = 6000
TOKEN_IN_TRANSCRIPT_RE = re.compile(r"\[\[\s*(.*?)\s*\]\]", re.DOTALL)


@dataclass
class CallContext:
    system_prompt: str
    greeting: str
    capabilities: frozenset
    patient: Optional[Patient] = None
    plan: Optional[Plan] = None

    @property
    def patient_full_name(self) -> Optional[str]:
        return f"{self.patient.first_name} {self.patient.last_name}" if self.patient else None


# ---------- Lookups ----------

async def lookup_caller(db: AsyncSession, phone_number: str) -> Optional[Patient]:
    """Find the chronic-care patient who owns this number (matched on the last 10 digits)."""
    digits = re.sub(r"\D", "", phone_number)[-10:]
    if len(digits) < 10:
        return None
    result = await db.execute(
        select(Patient)
        .where(
            Patient.status == "active",
            or_(Patient.phone_number.like(f"%{digits}"), Patient.secondary_phone.like(f"%{digits}")),
        )
        .limit(1)
    )
    return result.scalar_one_or_none()


def _plan_query():
    return select(Plan).options(
        joinedload(Plan.protocol),
        joinedload(Plan.patient_condition).joinedload(PatientCondition.chronic_condition),
    )


async def load_plan(db: AsyncSession, plan_id: int) -> Optional[Plan]:
    result = await db.execute(_plan_query().where(Plan.id == plan_id))
    return result.unique().scalar_one_or_none()


async def find_active_plan(db: AsyncSession, patient_id: int) -> Optional[Plan]:
    result = await db.execute(
        _plan_query()
        .where(Plan.patient_id == patient_id, Plan.status == "active")
        .order_by(Plan.id)
        .limit(1)
    )
    return result.unique().scalar_one_or_none()


async def patient_condition_names(db: AsyncSession, patient_id: int) -> List[str]:
    """Display names of the patient's active conditions that have an active care plan."""
    result = await db.execute(
        select(PatientCondition)
        .options(joinedload(PatientCondition.chronic_condition))
        .join(Plan, Plan.patient_condition_id == PatientCondition.id)
        .where(
            PatientCondition.patient_id == patient_id,
            PatientCondition.status == "active",
            Plan.status == "active",
        )
    )
    return [pc.chronic_condition.display_name for pc in result.scalars().unique().all()]


# ---------- Context builder ----------

async def build_call_context(db: AsyncSession, call: CallLog) -> CallContext:
    """Pick the prompt, greeting and capabilities for this call from its direction and caller."""
    patient = await db.get(Patient, call.patient_id) if call.patient_id else None
    plan: Optional[Plan] = None
    if call.plan_id:
        plan = await load_plan(db, call.plan_id)
    elif patient and call.direction != DIRECTION_OUTBOUND:
        # Known patient calling in: attach their care plan so the call is linked to it
        plan = await find_active_plan(db, patient.id)
        if plan:
            call.plan_id = plan.id
            await db.commit()

    agent = settings.clinic_agent_name
    clinic = settings.clinic_name

    if call.direction == DIRECTION_OUTBOUND:
        callback = await find_callback_for_call(db, call.id)
        if callback:
            return await build_callback_context(db, call, callback, patient, plan)
        if patient and plan and plan.protocol:
            prompt = build_system_prompt(
                patient=patient,
                plan=plan,
                protocol=plan.protocol,
                agent_name=agent,
                org_name=clinic,
            )
        else:
            name = patient.first_name if patient else "the patient"
            prompt = CHRONIC_FALLBACK_PROMPT.format(agent_name=agent, name=name, org_name=clinic)
        prompt += callback_instructions()
        who = f"Hello {patient.first_name}, " if patient else "Hello, "
        greeting = CHECKIN_GREETING.format(hello=who, agent_name=agent, org_name=clinic)
        return CallContext(
            system_prompt=prompt,
            greeting=greeting,
            capabilities=frozenset({CAP_ESCALATE, CAP_APPOINTMENT_REQUEST, CAP_CALLBACK}),
            patient=patient,
            plan=plan,
        )

    conditions = await patient_condition_names(db, patient.id) if patient else []
    prompt = await build_receptionist_prompt(db, call.phone_number or "", patient, conditions, plan)
    prompt += callback_instructions()
    who = f"Hello {patient.first_name}, " if patient else "Hello, "
    greeting = RECEPTIONIST_GREETING.format(hello=who, agent_name=agent, org_name=clinic)
    capabilities = {CAP_BOOK, CAP_CALLBACK}
    if plan:
        capabilities.add(CAP_ESCALATE)
    return CallContext(
        system_prompt=prompt,
        greeting=greeting,
        capabilities=frozenset(capabilities),
        patient=patient,
        plan=plan,
    )


async def _transcript_lines(db: AsyncSession, call: CallLog) -> List[str]:
    """The call's conversation as (role, text) lines; control tokens become plain notes."""
    if call.transcript and call.transcript.strip():
        raw = [line.strip() for line in call.transcript.splitlines() if line.strip()]
    else:
        turns = await db.execute(
            select(CallTurn).where(CallTurn.call_log_id == call.id).order_by(CallTurn.timestamp, CallTurn.id)
        )
        raw = [f"{t.role.upper()}: {t.content}" for t in turns.scalars().all()]

    lines = []
    for line in raw:
        role, _, text = line.partition(":")
        if role not in ("ASSISTANT", "USER"):
            continue
        # Keep what the system did ("BOOKED appointment #5") but never in a form the agent would re-send
        text = TOKEN_IN_TRANSCRIPT_RE.sub(lambda m: f"(system note: {m.group(1)})", text).strip()
        if text:
            lines.append(f"{'You' if role == 'ASSISTANT' else 'Them'}: {text}")
    return lines


async def earlier_calls(db: AsyncSession, callback: CallbackSchedule) -> List[CallLog]:
    """The call(s) this callback follows on from, oldest first.

    If the earlier call was itself a callback, its own earlier call is included too (up to
    HISTORY_MAX_CALLS), so the first item is the call that started it all.
    """
    calls: List[CallLog] = []
    seen = set()
    current: Optional[CallbackSchedule] = callback
    while current and len(calls) < HISTORY_MAX_CALLS:
        source = await find_source_call(db, current)
        if not source or source.id in seen:
            break
        calls.append(source)
        seen.add(source.id)
        current = await find_callback_for_call(db, source.id)  # was that call a callback too?
    calls.reverse()
    return calls


async def previous_conversations(db: AsyncSession, calls: Sequence[CallLog]) -> str:
    """Prompt section with the earlier conversations, so the agent remembers what was asked and answered."""
    if not calls:
        return ""

    offset = timedelta(minutes=settings.clinic_utc_offset_minutes)
    blocks = []
    for call in calls:
        when = (call.started_at or call.created_at or datetime.utcnow()) + offset
        lines = await _transcript_lines(db, call)
        conversation = "\n".join(lines)
        if len(conversation) > HISTORY_MAX_CHARS_PER_CALL:
            conversation = "(earlier part of this call trimmed)\n" + conversation[-HISTORY_MAX_CHARS_PER_CALL:]
        who = "they phoned the clinic" if call.direction != DIRECTION_OUTBOUND else "you phoned them"
        block = f"--- Call on {when.strftime('%A %d %b %Y, %I:%M %p')} ({who}) ---"
        if call.summary:
            block += f"\nSummary: {call.summary}"
        block += f"\nConversation:\n{conversation or '(nothing was recorded)'}"
        blocks.append(block)

    return PREVIOUS_CONVERSATIONS.format(blocks="\n\n".join(blocks))


def callback_instructions() -> str:
    """Prompt section for the [[SCHEDULE_CALLBACK]] token (every call)."""
    now = clinic_now()
    example = (now + timedelta(days=1)).replace(hour=17, minute=30).strftime("%Y-%m-%dT%H:%M")
    return CALLBACK_INSTRUCTIONS.format(now=now.strftime('%A %d %b %Y, %I:%M %p'), example=example)


async def build_callback_context(
    db: AsyncSession,
    call: CallLog,
    callback: CallbackSchedule,
    patient: Optional[Patient],
    plan: Optional[Plan],
) -> CallContext:
    """Calling back someone who asked for it during an earlier call, or whom staff want followed up."""
    agent = settings.clinic_agent_name
    clinic = settings.clinic_name
    calls = await earlier_calls(db, callback)
    history = await previous_conversations(db, calls)
    # The call that started it all decides whether this resumes a check-in
    origin = calls[0] if calls else None
    full_name = (
        f"{patient.first_name} {patient.last_name}"
        if patient
        else callback.patient_name or next((c.patient_name for c in reversed(calls) if c.patient_name), None)
    )
    first_name = full_name.split()[0] if full_name else None
    hello = f"Hello {first_name}, " if first_name else "Hello, "
    reason = callback.notes
    by_staff = callback.schedule_type == SCHEDULE_TYPE_STAFF
    # Never claim they asked for it when the clinic team scheduled it
    why = "following up on your earlier call" if by_staff else "calling you back as you asked"

    if len(calls) > 1:
        earlier = "You have already spoken with this person more than once (see below)"
    elif origin and origin.direction == DIRECTION_OUTBOUND:
        earlier = "Earlier the patient was on their health check-in call"
    else:
        earlier = "Earlier this person phoned the clinic"
    asked = (
        ". The clinic team asked you to call them back to follow up" if by_staff else " and asked to be called back"
    )
    note = CALLBACK_NOTE.format(earlier=earlier, asked=asked, reason=f" ({reason})" if reason else "") + history

    # They were in the middle of a check-in: pick it up again
    if origin and origin.direction == DIRECTION_OUTBOUND and patient and plan and plan.protocol:
        prompt = build_system_prompt(patient=patient, plan=plan, protocol=plan.protocol, agent_name=agent, org_name=clinic)
        return CallContext(
            system_prompt=prompt + note + callback_instructions(),
            greeting=CALLBACK_CHECKIN_GREETING.format(hello=hello, agent_name=agent, org_name=clinic, why=why),
            capabilities=frozenset({CAP_ESCALATE, CAP_APPOINTMENT_REQUEST, CAP_CALLBACK}),
            patient=patient,
            plan=plan,
        )

    conditions = await patient_condition_names(db, patient.id) if patient else []
    prompt = await build_receptionist_prompt(
        db, call.phone_number or "", patient, conditions, plan, callback_note=note, caller_name=full_name
    )
    about = f" about {reason}" if reason else ""
    capabilities = {CAP_BOOK, CAP_CALLBACK}
    if plan:
        capabilities.add(CAP_ESCALATE)
    return CallContext(
        system_prompt=prompt + callback_instructions(),
        greeting=CALLBACK_GREETING.format(hello=hello, agent_name=agent, org_name=clinic, why=why, about=about),
        capabilities=frozenset(capabilities),
        patient=patient,
        plan=plan,
    )


# ---------- Receptionist prompt ----------

def _plan_block(patient: Patient, plan: Plan, conditions: Sequence[str]) -> str:
    """Extra prompt section for a caller who is enrolled in chronic-care follow-up."""
    protocol = plan.protocol
    red_flags = []
    for criterion in (protocol.red_flag_criteria if protocol else None) or []:
        if "description" not in criterion:
            continue
        cid = criterion.get("id") or criterion.get("criterion_id")
        label = f" [id: {cid}]" if cid else ""
        red_flags.append(f"  - {criterion['description']}{label} (severity: {criterion.get('severity', 'unknown')})")
    red_flag_text = "\n".join(red_flags) or "  - Any severe or rapidly worsening symptom"
    last = plan.last_outreach_at.strftime("%d %b %Y") if plan.last_outreach_at else "none yet"
    return CARE_PLAN_BLOCK.format(
        conditions=', '.join(conditions) or 'not listed',
        physician=plan.assigned_physician_name or 'not assigned',
        last_checkin=last,
        red_flag_text=red_flag_text,
    )


async def build_receptionist_prompt(
    db: AsyncSession,
    phone_number: str,
    patient: Optional[Patient] = None,
    conditions: Sequence[str] = (),
    plan: Optional[Plan] = None,
    callback_note: Optional[str] = None,
    caller_name: Optional[str] = None,
) -> str:
    """Receptionist prompt; with callback_note the agent is calling someone back instead of answering."""
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

    if patient:
        caller_hint = CALLER_HINT_PATIENT.format(
            full_name=f"{patient.first_name} {patient.last_name}",
            followed_for=f", being followed for {', '.join(conditions)}" if conditions else "",
        )
    elif caller_name:
        caller_hint = CALLER_HINT_NAMED.format(caller_name=caller_name)
    elif callback_note:
        caller_hint = CALLER_HINT_CALLBACK_UNKNOWN
    else:
        caller_hint = CALLER_HINT_UNKNOWN

    care_block = _plan_block(patient, plan, conditions) if patient and plan else ""
    escalate_token = ESCALATION_TOKEN_BLOCK if care_block else ""

    return RECEPTIONIST_PROMPT.format(
        agent_name=settings.clinic_agent_name,
        org_name=settings.clinic_name,
        situation=callback_note or LIVE_CALL_SITUATION,
        now=now.strftime('%A %d %b %Y, %I:%M %p'),
        phone_number=phone_number,
        caller_hint=caller_hint,
        care_block=care_block,
        doctor_blocks="\n".join(doctor_blocks),
        escalate_token=escalate_token,
    )
