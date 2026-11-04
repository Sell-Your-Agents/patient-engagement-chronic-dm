import asyncio
import logging
from datetime import datetime
from typing import List
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.config import get_settings
from app.models.plan import Plan
from app.models.patient import Patient
from app.models.call_log import CallLog, DIRECTION_OUTBOUND
from app.models.callback_schedule import CallbackSchedule

logger = logging.getLogger(__name__)
settings = get_settings()


async def get_scheduler_session():
    """Create a database session for scheduler tasks."""
    engine = create_async_engine(
        settings.database_url,
        echo=False,
        future=True,
    )
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    return async_session()


async def get_due_plans(db: AsyncSession) -> List[Plan]:
    """Find all active care plans due for outreach."""
    result = await db.execute(
        select(Plan)
        .where(Plan.status == "active")
        .where(Plan.next_due_date <= datetime.utcnow())
    )
    return result.scalars().all()


async def initiate_call(patient_id: int, plan_id: int, db: AsyncSession) -> CallLog:
    """Initiate an outreach call for a patient."""
    outreach_call = CallLog(
        direction=DIRECTION_OUTBOUND,
        patient_id=patient_id,
        plan_id=plan_id,
        channel="voice",
        status="initiated",
        attempt_number=1,
    )
    db.add(outreach_call)
    await db.flush()
    return outreach_call


async def run_outreach_scheduler():
    """Main scheduler loop - runs every N seconds to find and initiate calls."""
    logger.info("Outreach scheduler starting...")

    while True:
        try:
            db = await get_scheduler_session()

            # Pass 1: Check due care plans
            logger.info("Scheduler: Checking for due care plans...")
            due_plans = await get_due_plans(db)

            for plan in due_plans:
                # Verify patient is active and has consent
                result = await db.execute(
                    select(Patient).where(Patient.id == plan.patient_id)
                )
                patient = result.scalar_one_or_none()

                if not patient:
                    logger.warning(f"Patient {plan.patient_id} not found")
                    continue

                if patient.status != "active":
                    logger.info(f"Patient {patient.id} is not active, skipping")
                    continue

                if not patient.communication_consent:
                    logger.info(f"Patient {patient.id} has not consented, skipping")
                    continue

                # Initiate call
                try:
                    outreach_call = await initiate_call(patient.id, plan.id, db)
                    logger.info(
                        f"Initiated call {outreach_call.id} for patient {patient.id} "
                        f"(care plan {plan.id})"
                    )
                except Exception as e:
                    logger.error(f"Error initiating call for patient {patient.id}: {e}")

            await db.commit()
            await db.close()

            # Wait before next check
            logger.debug(f"Scheduler: Waiting {settings.scheduler_poll_seconds} seconds...")
            await asyncio.sleep(settings.scheduler_poll_seconds)

        except Exception as e:
            logger.error(f"Scheduler error: {e}")
            try:
                await db.close()
            except Exception:
                pass
            # Wait before retrying
            await asyncio.sleep(settings.scheduler_poll_seconds)
