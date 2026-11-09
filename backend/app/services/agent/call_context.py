"""Which agent context a call gets. One agent (settings.clinic_agent_name) handles every call:

- outbound check-in                        -> outbound_context.build_checkin_context
- outbound callback after a check-in       -> outbound_context.build_checkin_callback_context
- inbound call to the clinic number        -> inbound_context.build_inbound_context
- outbound callback to someone who phoned  -> inbound_context.build_receptionist_callback_context

All prompt text lives in app/prompts/ (common_prompts, outbound_prompts, inbound_prompts).
The capabilities set decides which control tokens the session will act on.
"""
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.call_log import DIRECTION_OUTBOUND, CallLog
from app.models.patient import Patient
from app.models.plan import Plan
from app.services.agent.context_shared import (  # noqa: F401  (re-exported for call_agent / routers)
    CAP_APPOINTMENT_REQUEST,
    CAP_BOOK,
    CAP_CALLBACK,
    CAP_ESCALATE,
    CallContext,
    earlier_calls,
    find_active_plan,
    load_plan,
    lookup_caller,
)
from app.services.agent.inbound_context import build_inbound_context, build_receptionist_callback_context
from app.services.agent.outbound_context import build_checkin_callback_context, build_checkin_context
from app.services.scheduling.callback_service import find_callback_for_call


async def build_call_context(db: AsyncSession, call: CallLog) -> CallContext:
    """Pick the prompt, opening line and capabilities for this call from its direction and history."""
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

    if call.direction != DIRECTION_OUTBOUND:
        return await build_inbound_context(db, call, patient, plan)

    callback = await find_callback_for_call(db, call.id)
    if not callback:
        return build_checkin_context(call, patient, plan)

    # A callback: the call that started it all decides which agent picks it up again
    calls = await earlier_calls(db, callback)
    origin = calls[0] if calls else None
    if origin is not None and origin.direction != DIRECTION_OUTBOUND:
        return await build_receptionist_callback_context(db, call, callback, calls, patient, plan)
    return await build_checkin_callback_context(db, call, callback, calls, patient, plan)
