"""Background loop that places feedback callbacks scheduled from Call Logs."""
import asyncio
import logging
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models.next_outreach_schedule import NextOutreachSchedule
from app.routers.outreach_calls import feedback_target, place_call

logger = logging.getLogger(__name__)
settings = get_settings()


def _add_note(schedule: NextOutreachSchedule, note: str) -> None:
    schedule.notes = f"{schedule.notes}\n{note}" if schedule.notes else note


async def dial_due_feedback_calls(db: AsyncSession) -> None:
    result = await db.execute(
        select(NextOutreachSchedule)
        .where(NextOutreachSchedule.schedule_type == "feedback")
        .where(NextOutreachSchedule.status == "pending")
        .where(NextOutreachSchedule.scheduled_time <= datetime.utcnow())
        .order_by(NextOutreachSchedule.scheduled_time)
    )
    for schedule in result.scalars().all():
        # Claim it first so a slow dial is never picked up twice
        schedule.status = "dialing"
        await db.commit()
        try:
            patient, care_plan = await feedback_target(db, schedule.patient_id, schedule.care_plan_id)
            call = await place_call(db, patient, care_plan, purpose="feedback")
            schedule.status = "dialed"
            _add_note(schedule, f"Call #{call.id} placed at {datetime.utcnow():%Y-%m-%d %H:%M} UTC")
            logger.info(f"Scheduled feedback callback #{schedule.id}: placed call #{call.id}")
        except HTTPException as exc:
            schedule.status = "failed"
            _add_note(schedule, f"Failed: {exc.detail}")
            logger.warning(f"Scheduled feedback callback #{schedule.id} failed: {exc.detail}")
        await db.commit()


async def run_feedback_scheduler() -> None:
    logger.info("Feedback callback scheduler started")
    while True:
        try:
            async with AsyncSessionLocal() as db:
                await dial_due_feedback_calls(db)
        except Exception as exc:
            logger.error(f"Feedback scheduler error: {exc}", exc_info=True)
        await asyncio.sleep(settings.scheduler_poll_seconds)
