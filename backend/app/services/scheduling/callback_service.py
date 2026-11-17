"""Follow-ups for clinic staff (the one call-back list). The agent never places calls itself."""
import logging
from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.callback_schedule import (
    DEFAULT_PRIORITY,
    FOLLOWUP_DONE,
    FOLLOWUP_PENDING,
    KIND_CALLBACK,
    KIND_CONFIRM_APPOINTMENT,
    PRIORITY_NORMAL,
    FollowUp,
)

logger = logging.getLogger(__name__)


async def create_follow_up(
    db: AsyncSession,
    *,
    kind: str = KIND_CALLBACK,
    priority: Optional[str] = None,
    call_log_id: Optional[int] = None,
    appointment_id: Optional[int] = None,
    patient_id: Optional[int] = None,
    patient_name: Optional[str] = None,
    phone_number: Optional[str] = None,
    doctor_requested: Optional[str] = None,
    preferred_time: Optional[str] = None,
    reason: Optional[str] = None,
    follow_up_at: Optional[datetime] = None,
) -> FollowUp:
    """Add a task to the staff follow-up list."""
    task = FollowUp(
        kind=kind,
        priority=priority or DEFAULT_PRIORITY.get(kind, PRIORITY_NORMAL),
        call_log_id=call_log_id,
        appointment_id=appointment_id,
        patient_id=patient_id,
        patient_name=patient_name,
        phone_number=phone_number,
        doctor_requested=doctor_requested,
        preferred_time=preferred_time,
        reason=reason,
        follow_up_at=follow_up_at,
        status=FOLLOWUP_PENDING,
    )
    db.add(task)
    await db.flush()
    logger.info(f"Follow-up #{task.id} ({kind}) created for {phone_number or 'unknown number'}")
    return task


async def pending_callback_for_call(db: AsyncSession, call_log_id: int) -> Optional[FollowUp]:
    """The callback task this call already created, if any (not the appointment-confirmation ones)."""
    result = await db.execute(
        select(FollowUp)
        .where(FollowUp.call_log_id == call_log_id, FollowUp.kind == KIND_CALLBACK)
        .order_by(FollowUp.id.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def close_appointment_follow_ups(db: AsyncSession, appointment_id: int, user_id: Optional[int]) -> None:
    """Staff confirmed or cancelled an appointment: its "confirm appointment" task is done."""
    result = await db.execute(
        select(FollowUp).where(
            FollowUp.appointment_id == appointment_id,
            FollowUp.kind == KIND_CONFIRM_APPOINTMENT,
            FollowUp.status == FOLLOWUP_PENDING,
        )
    )
    for task in result.scalars().all():
        task.status = FOLLOWUP_DONE
        task.completed_at = datetime.utcnow()
        task.completed_by_user_id = user_id
