"""What the single phone agent knows and is allowed to do on a given call.

One agent (settings.clinic_agent_name) handles every call. The call's direction and the caller
decide the context:

- outbound            -> health-coaching check-in built from the patient's disease protocol
- inbound             -> receptionist: picks a doctor and books a slot
- inbound + patient   -> receptionist that also knows the patient's care plan and red flags

Prompts stay separate modules (coaching content never leaks into the receptionist prompt for
strangers); the capabilities set decides which control tokens the session will act on.
"""
import logging
import re
from dataclasses import dataclass
from typing import List, Optional, Sequence

from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.config import get_settings
from app.models.call_log import CallLog, DIRECTION_OUTBOUND
from app.models.plan import Plan
from app.models.condition import PatientCondition
from app.models.patient import Patient
from app.services.clinic_scheduling import (
    clinic_now,
    format_day,
    get_active_doctors,
    get_free_slots,
)
from app.services.prompt_builder import build_system_prompt

logger = logging.getLogger(__name__)
settings = get_settings()

# Control-token capabilities
CAP_BOOK = "book"  # [[BOOK_APPOINTMENT ...]] books a real slot
CAP_ESCALATE = "escalate"  # [[ESCALATE:id]] raises an escalation case right away
CAP_APPOINTMENT_REQUEST = "appointment_request"  # [[APPOINTMENT_REQUESTED]] (staff arrange the time)

# Days of availability shown to the agent per doctor (keeps the prompt small)
PROMPT_DAYS_PER_DOCTOR = 3


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
            prompt = f"You are {agent}, a friendly health coach calling {name} on behalf of {clinic}."
        who = f"Hello {patient.first_name}, " if patient else "Hello, "
        greeting = (
            f"{who}this is {agent} from {clinic}, calling for your regular health check-in. "
            "How are you feeling today?"
        )
        return CallContext(
            system_prompt=prompt,
            greeting=greeting,
            capabilities=frozenset({CAP_ESCALATE, CAP_APPOINTMENT_REQUEST}),
            patient=patient,
            plan=plan,
        )

    conditions = await patient_condition_names(db, patient.id) if patient else []
    prompt = await build_receptionist_prompt(db, call.phone_number or "", patient, conditions, plan)
    who = f"Hello {patient.first_name}, " if patient else "Hello, "
    greeting = f"{who}thank you for calling {clinic}, this is {agent}. How can I help you today?"
    capabilities = {CAP_BOOK}
    if plan:
        capabilities.add(CAP_ESCALATE)
    return CallContext(
        system_prompt=prompt,
        greeting=greeting,
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
    return f"""
CARE PLAN (this caller is enrolled in chronic-care follow-up)
- Conditions: {', '.join(conditions) or 'not listed'}. Assigned physician: {plan.assigned_physician_name or 'not assigned'}. Last check-in call: {last}.
- If the caller mentions any of these red flags, include the token [[ESCALATE:<id>]] once (e.g. [[ESCALATE:chest_pain]]; use a short snake_case id if none is given), tell them clearly to seek urgent care if it is serious, and still help them book a visit:
{red_flag_text}
- Never give clinical advice; defer to their physician.
"""


async def build_receptionist_prompt(
    db: AsyncSession,
    phone_number: str,
    patient: Optional[Patient] = None,
    conditions: Sequence[str] = (),
    plan: Optional[Plan] = None,
) -> str:
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
        caller_hint = (
            f"The caller's number matches an enrolled chronic-care patient: {patient.first_name} {patient.last_name}"
            + (f", being followed for {', '.join(conditions)}" if conditions else "")
            + ". Greet them by first name and confirm it is them before discussing anything. "
            "You may mention their condition only to route them to the right doctor (e.g. diabetes or blood pressure "
            "follow-up goes to the General Physician or Cardiologist); do not give clinical advice."
        )
    else:
        caller_hint = "This number is not in our patient records, so you do not know the caller's name yet."

    care_block = _plan_block(patient, plan, conditions) if patient and plan else ""
    escalate_token = (
        "\nESCALATION TOKEN\n[[ESCALATE:<id>]] alerts the care team immediately. It is invisible to the caller. "
        "Use it only for the red flags listed under CARE PLAN, once per red flag.\n"
        if care_block
        else ""
    )

    return f"""You are {settings.clinic_agent_name}, a warm and professional receptionist answering the phone for {settings.clinic_name}.
You are on a live PHONE call. The person called the clinic and you have just picked up.
Current clinic date/time: {now.strftime('%A %d %b %Y, %I:%M %p')}.
Caller phone: {phone_number}. {caller_hint}
{care_block}
YOUR GOAL
1. Welcome them and ask how the clinic can help.
2. Understand why they are calling: their main problem or symptoms, since when, and whether it is for themselves or someone else.
3. Ask for the patient's full name (skip if you already know it and they confirmed).
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
{escalate_token}
ENDING THE CALL
When the conversation is finished and you have said goodbye, add [[END_CALL]] at the very end of your final reply.

SPEAKING STYLE
- Speak naturally in English, like a friendly receptionist. Keep each reply to one to three short sentences.
- Ask one question at a time. No lists, no markdown, no emojis.
- When speaking, say "Doctor" instead of the abbreviation "Dr." (e.g. "Doctor Ananya Rao").
- Say times like "nine fifteen in the morning" or "9:15 AM", and dates like "Thursday, 16th October".
"""
