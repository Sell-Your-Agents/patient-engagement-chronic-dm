"""The agent's context for a call. Every call is a call to the clinic (phone or browser test),
so this only loads the caller's record and hands over to inbound_context.

All prompt text lives in app/prompts/ (common_prompts, inbound_prompts).
The capabilities set decides which control tokens the session will act on.
"""
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.call_log import CallLog
from app.models.patient import Patient
from app.services.agent.context_shared import (  # noqa: F401  (re-exported for call_agent / routers)
    CAP_APPOINTMENT_REQUEST,
    CAP_CALLBACK,
    CAP_ESCALATE,
    CAP_HUMAN,
    CAP_LANGUAGE,
    CAP_UNANSWERED,
    CallContext,
    lookup_caller,
)
from app.services.agent.inbound_context import build_inbound_context


async def build_call_context(db: AsyncSession, call: CallLog) -> CallContext:
    patient = await db.get(Patient, call.patient_id) if call.patient_id else None
    return await build_inbound_context(db, call, patient)
