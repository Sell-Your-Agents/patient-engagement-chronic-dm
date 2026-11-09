"""Calls Maya places: chronic-care health check-ins, and calling back people from a check-in.

Every outbound call opens with "Am I speaking with <full name>?" and shares nothing about the
call until the person confirms (see common_prompts.CALLER_IDENTITY_RULES).
"""
from typing import Optional, Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.call_log import CallLog
from app.models.callback_schedule import SCHEDULE_TYPE_STAFF, CallbackSchedule
from app.models.patient import Patient
from app.models.plan import Plan
from app.prompts.chronic_prompt import build_system_prompt
from app.prompts.common_prompts import CALLBACK_OPENING, CALLBACK_OPENING_NO_NAME
from app.prompts.outbound_prompts import CHECKIN_CALLBACK_NOTE, CHECKIN_OPENING, CHRONIC_FALLBACK_PROMPT
from app.services.agent.context_shared import (
    CAP_APPOINTMENT_REQUEST,
    CAP_CALLBACK,
    CAP_ESCALATE,
    CallContext,
    callback_why,
    caller_identity_rules,
    earlier_text,
    full_name,
    now_text,
    one_line,
    previous_conversations,
    recording_line,
    shared_rules,
)

settings = get_settings()

OUTBOUND_CAPABILITIES = frozenset({CAP_ESCALATE, CAP_APPOINTMENT_REQUEST, CAP_CALLBACK})


def _call_prompt(patient: Optional[Patient], plan: Optional[Plan]) -> str:
    """The check-in prompt when there is a usable care plan, otherwise the general follow-up prompt."""
    if patient and plan and plan.protocol:
        return build_system_prompt(patient, plan, plan.protocol)
    return CHRONIC_FALLBACK_PROMPT.format(
        agent_name=settings.clinic_agent_name,
        org_name=settings.clinic_name,
        now=now_text(),
        full_name=full_name(patient) or "the person you are calling",
    )


def _opening(template: str, call: CallLog, name: Optional[str]) -> str:
    if not name:
        template = CALLBACK_OPENING_NO_NAME
    return one_line(template.format(
        agent_name=settings.clinic_agent_name,
        org_name=settings.clinic_name,
        recording_line=recording_line(call),
        full_name=name or "",
    ))


def build_checkin_context(call: CallLog, patient: Optional[Patient], plan: Optional[Plan]) -> CallContext:
    """A scheduled or staff-started health check-in call."""
    name = full_name(patient)
    prompt = _call_prompt(patient, plan) + caller_identity_rules(name) + shared_rules()
    return CallContext(
        system_prompt=prompt,
        greeting=_opening(CHECKIN_OPENING, call, name),
        capabilities=OUTBOUND_CAPABILITIES,
        patient=patient,
        plan=plan,
    )


async def build_checkin_callback_context(
    db: AsyncSession,
    call: CallLog,
    callback: CallbackSchedule,
    calls: Sequence[CallLog],
    patient: Optional[Patient],
    plan: Optional[Plan],
) -> CallContext:
    """Calling back someone whose earlier call was a check-in (asked for by them, family, or staff)."""
    name = full_name(patient) or callback.patient_name
    why = callback_why(callback, calls)
    if callback.schedule_type == SCHEDULE_TYPE_STAFF and callback.notes:
        why += f" about {callback.notes.strip().rstrip('.')}"
    elif plan and plan.protocol:
        why += ", so I'm calling for your health check-in"
    else:
        why += ", so I'm calling to see how you're doing"
    note = CHECKIN_CALLBACK_NOTE.format(earlier=earlier_text(calls), why=why)
    history = await previous_conversations(db, calls, name)
    prompt = _call_prompt(patient, plan) + note + history + caller_identity_rules(name) + shared_rules()
    return CallContext(
        system_prompt=prompt,
        greeting=_opening(CALLBACK_OPENING, call, name),
        capabilities=OUTBOUND_CAPABILITIES,
        patient=patient,
        plan=plan,
    )
