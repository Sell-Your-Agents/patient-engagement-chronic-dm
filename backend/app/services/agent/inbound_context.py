"""Calls to the clinic number (Maya as receptionist), and calling those callers back.

The receptionist picks a doctor and books a real slot. It never greets a caller by name from
the phone number alone: a known number only gets its care plan after the caller confirms who
they are (see inbound_prompts.CALLER_HINT_PATIENT).
"""
from typing import Optional, Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.call_log import CallLog
from app.models.callback_schedule import CallbackSchedule
from app.models.patient import Patient
from app.models.plan import Plan
from app.prompts.common_prompts import CALLBACK_OPENING, CALLBACK_OPENING_NO_NAME
from app.prompts.inbound_prompts import (
    CALLER_HINT_NAMED,
    CALLER_HINT_PATIENT,
    CALLER_HINT_UNKNOWN,
    CARE_PLAN_BLOCK,
    LIVE_CALL_SITUATION,
    RECEPTIONIST_CALLBACK_SITUATION,
    RECEPTIONIST_OPENING,
    RECEPTIONIST_PROMPT,
)
from app.services.agent.context_shared import (
    CAP_BOOK,
    CAP_CALLBACK,
    CAP_ESCALATE,
    CallContext,
    callback_why,
    caller_identity_rules,
    earlier_text,
    full_name,
    now_text,
    one_line,
    patient_condition_names,
    previous_conversations,
    recording_line,
    red_flag_lines,
    shared_rules,
)
from app.services.scheduling.clinic_scheduling import clinic_now, format_day, get_active_doctors, get_free_slots

settings = get_settings()

# Days of availability shown to the agent per doctor (keeps the prompt small)
PROMPT_DAYS_PER_DOCTOR = 3

INBOUND_CAPABILITIES = frozenset({CAP_BOOK, CAP_CALLBACK, CAP_ESCALATE})


def _care_block(patient: Patient, plan: Plan, conditions: Sequence[str]) -> str:
    """Extra prompt section for a caller whose number matches an enrolled chronic-care patient."""
    last = plan.last_outreach_at.strftime("%d %b %Y") if plan.last_outreach_at else "none yet"
    return CARE_PLAN_BLOCK.format(
        full_name=full_name(patient),
        conditions=", ".join(conditions) or "not listed",
        physician=plan.assigned_physician_name or "not assigned",
        last_checkin=last,
        red_flag_text=red_flag_lines(plan.protocol),
    )


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
        blocks.append(
            f"* {doctor.name} (doctor_id={doctor.id}), {doctor.specialty}, {doctor.slot_minutes}-minute appointments\n"
            f"  Treats: {doctor.treats}\n"
            f"  Free slots (24h clock):\n{availability}"
        )
    return "\n".join(blocks) or "* No doctors are available for booking right now. Offer a callback from the front desk."


async def build_receptionist_prompt(
    db: AsyncSession,
    phone_number: str,
    patient: Optional[Patient],
    plan: Optional[Plan],
    situation: str,
    caller_name: Optional[str] = None,
) -> str:
    """The receptionist prompt (without the shared rules)."""
    conditions = await patient_condition_names(db, patient.id) if patient else []
    if patient:
        caller_hint = CALLER_HINT_PATIENT.format(
            full_name=full_name(patient),
            followed_for=f", followed for {', '.join(conditions)}" if conditions else "",
        )
    elif caller_name:
        caller_hint = CALLER_HINT_NAMED.format(caller_name=caller_name)
    else:
        caller_hint = CALLER_HINT_UNKNOWN

    return RECEPTIONIST_PROMPT.format(
        agent_name=settings.clinic_agent_name,
        org_name=settings.clinic_name,
        situation=situation,
        now=now_text(),
        phone_number=phone_number or "unknown",
        caller_hint=caller_hint,
        care_block=_care_block(patient, plan, conditions) if patient and plan else "",
        doctor_blocks=await _doctor_blocks(db),
    )


async def build_inbound_context(
    db: AsyncSession, call: CallLog, patient: Optional[Patient], plan: Optional[Plan]
) -> CallContext:
    """Someone phoned the clinic number (a real phone or the browser 'Call the Agent' page)."""
    prompt = await build_receptionist_prompt(db, call.phone_number or "", patient, plan, LIVE_CALL_SITUATION)
    greeting = one_line(RECEPTIONIST_OPENING.format(
        org_name=settings.clinic_name,
        agent_name=settings.clinic_agent_name,
        recording_line=recording_line(call),
    ))
    return CallContext(
        system_prompt=prompt + shared_rules(),
        greeting=greeting,
        capabilities=INBOUND_CAPABILITIES,
        patient=patient,
        plan=plan,
    )


async def build_receptionist_callback_context(
    db: AsyncSession,
    call: CallLog,
    callback: CallbackSchedule,
    calls: Sequence[CallLog],
    patient: Optional[Patient],
    plan: Optional[Plan],
) -> CallContext:
    """Maya calls back someone who phoned the clinic earlier (the missed-call / callback agent)."""
    name = full_name(patient) or callback.patient_name or next((c.patient_name for c in reversed(calls) if c.patient_name), None)
    why = callback_why(callback, calls)
    reason = (callback.notes or "").strip().rstrip(".")
    why += f" about {reason}" if reason else ""
    situation = RECEPTIONIST_CALLBACK_SITUATION.format(earlier=earlier_text(calls), why=why)
    history = await previous_conversations(db, calls, name)
    prompt = await build_receptionist_prompt(db, call.phone_number or "", patient, plan, situation, caller_name=name)
    template = CALLBACK_OPENING if name else CALLBACK_OPENING_NO_NAME
    greeting = one_line(template.format(
        agent_name=settings.clinic_agent_name,
        org_name=settings.clinic_name,
        recording_line=recording_line(call),
        full_name=name or "",
    ))
    return CallContext(
        system_prompt=prompt + history + caller_identity_rules(name) + shared_rules(),
        greeting=greeting,
        capabilities=INBOUND_CAPABILITIES,
        patient=patient,
        plan=plan,
    )
