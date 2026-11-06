"""Scheduled health check-in calls: the agent calls each patient when their care plan falls due.

A plan's next_due_date comes from the follow-up interval (and call time) set on the Chronic
Condition page. When it passes, this loop dials the patient; the call is an ordinary outbound
check-in call, so it shows in the call log. When the call is finalized, the plan is moved on by
its follow-up interval (see call_finalizer). An unanswered check-in is tried again
CHECKIN_RETRY_DELAY later, up to CHECKIN_MAX_ATTEMPTS times, then escalated to staff and moved to
the next interval. Calls are only placed during clinic calling hours, except for plans that
repeat every N minutes (and CHECKIN_TEST_INTERVAL_MINUTES testing), which are called at any hour.
"""
import asyncio
import logging
from datetime import datetime, time, timedelta
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models.call_log import CallLog, DIRECTION_OUTBOUND
from app.models.disease_protocol import DiseaseProtocol
from app.models.escalation import Escalation
from app.models.patient import Patient
from app.models.plan import Plan
from app.services.scheduling.callback_service import place_agent_call, twilio_configured
from app.services.scheduling.clinic_scheduling import clinic_now, followup_minutes, next_followup_due

logger = logging.getLogger(__name__)
settings = get_settings()

# CallLog.reason of calls placed by this loop
CHECKIN_REASON = "scheduled_checkin"
# Tries per due check-in before staff are told, and the wait between tries
CHECKIN_MAX_ATTEMPTS = 3
CHECKIN_RETRY_DELAY = timedelta(hours=1)
# An unanswered check-in older than this starts a fresh round of tries
CHECKIN_ROUND_WINDOW = timedelta(hours=12)
# A check-in still ringing / in progress this recently is left alone
CHECKIN_ACTIVE_WINDOW = timedelta(hours=2)
ACTIVE_STATUSES = ("initiated", "ringing", "in-progress", "in_progress")


def _parse_hhmm(value: str) -> time:
    hours, minutes = value.split(":")
    return time(int(hours), int(minutes))


def within_calling_hours() -> bool:
    now = clinic_now().time()
    return _parse_hhmm(settings.checkin_call_start) <= now < _parse_hhmm(settings.checkin_call_end)


def retry_delay(plan: Plan) -> timedelta:
    """Wait before trying an unanswered check-in again; never longer than a minutes interval."""
    minutes = followup_minutes(plan.followup_interval_minutes)
    return min(timedelta(minutes=minutes), CHECKIN_RETRY_DELAY) if minutes else CHECKIN_RETRY_DELAY


async def _next_due(db: AsyncSession, plan: Plan) -> datetime:
    """The plan's next check-in after now, at the condition's call time if it has one."""
    protocol = await db.get(DiseaseProtocol, plan.protocol_id)
    return next_followup_due(
        datetime.utcnow(),
        plan.followup_interval_days,
        protocol.default_call_time if protocol else None,
        plan.followup_interval_minutes,
    )


async def _latest_checkin(db: AsyncSession, plan_id: int) -> Optional[CallLog]:
    result = await db.execute(
        select(CallLog)
        .where(CallLog.plan_id == plan_id, CallLog.reason == CHECKIN_REASON)
        .order_by(CallLog.created_at.desc(), CallLog.id.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _claim_plan(db: AsyncSession, plan: Plan, due: datetime, new_due: datetime) -> bool:
    """Atomically move the plan's due date on so it is dialled only once."""
    result = await db.execute(
        update(Plan).where(Plan.id == plan.id, Plan.next_due_date == due).values(next_due_date=new_due)
    )
    await db.commit()
    return result.rowcount == 1


async def dial_checkin(db: AsyncSession, plan: Plan, patient: Patient, attempt: int) -> CallLog:
    """Have the agent place a health check-in call for a claimed plan."""
    call = CallLog(
        direction=DIRECTION_OUTBOUND,
        patient_id=patient.id,
        plan_id=plan.id,
        phone_number=patient.phone_number,
        patient_name=f"{patient.first_name} {patient.last_name}",
        channel="voice",
        status="initiated",
        reason=CHECKIN_REASON,
        attempt_number=attempt,
        is_retry=attempt > 1,
    )
    db.add(call)
    await db.flush()

    if not twilio_configured():
        # Same mock as POST /api/calls; counts as done so it is not retried every hour
        logger.warning(f"Twilio not configured - mock check-in call for plan #{plan.id}")
        call.status = "completed"
        call.call_sid = f"SM_mock_{call.id}"
        call.transcript = "[Mock call - Twilio not configured]"
        call.duration_seconds = 0
        plan.last_outreach_at = datetime.utcnow()
        plan.next_due_date = await _next_due(db, plan)
    else:
        try:
            call.call_sid = await place_agent_call(patient.phone_number)
            logger.info(f"Plan #{plan.id}: check-in call #{call.id} (attempt {attempt}) to {patient.phone_number}")
        except Exception as exc:
            logger.error(f"Plan #{plan.id}: dialling check-in failed: {exc}")
            call.status = "failed"
            call.ended_at = datetime.utcnow()

    await db.commit()
    return call


async def dial_due_checkins(db: AsyncSession) -> int:
    """Dial every active plan whose check-in is due. Returns how many calls were placed."""
    now = datetime.utcnow()
    result = await db.execute(
        select(Plan.id)
        .where(Plan.status == "active", Plan.next_due_date <= now)
        .order_by(Plan.next_due_date)
    )
    dialled = 0
    for plan_id in result.scalars().all():
        try:
            if await _handle_due_plan(db, plan_id, now):
                dialled += 1
        except Exception as exc:
            logger.error(f"Plan #{plan_id}: {exc}", exc_info=True)
            await db.rollback()
    return dialled


async def _handle_due_plan(db: AsyncSession, plan_id: int, now: datetime) -> bool:
    plan = await db.get(Plan, plan_id)
    due = plan.next_due_date
    if not followup_minutes(plan.followup_interval_minutes) and not within_calling_hours():
        return False  # stays due until calling hours start
    patient = await db.get(Patient, plan.patient_id)
    if not patient or patient.status != "active" or not patient.communication_consent or not patient.phone_number:
        # Not callable now; look again at the next interval instead of every poll
        if await _claim_plan(db, plan, due, await _next_due(db, plan)):
            logger.info(f"Plan #{plan.id}: patient not callable (inactive, no consent or no phone); skipped")
        return False

    latest = await _latest_checkin(db, plan.id)
    answered = latest and plan.last_outreach_at and plan.last_outreach_at >= latest.created_at
    if latest and latest.status in ACTIVE_STATUSES and latest.created_at >= now - CHECKIN_ACTIVE_WINDOW:
        return False  # the last check-in is still ringing or on the line
    # Staff were already told about the last round of missed calls: start a new round
    gave_up = latest and await db.scalar(
        select(Escalation.id).where(Escalation.call_log_id == latest.id).limit(1)
    )
    attempt = 1
    if latest and not answered and not gave_up and latest.created_at >= now - CHECKIN_ROUND_WINDOW:
        attempt = (latest.attempt_number or 1) + 1

    if attempt > CHECKIN_MAX_ATTEMPTS:
        if await _claim_plan(db, plan, due, await _next_due(db, plan)):
            db.add(Escalation(
                call_log_id=latest.id,
                patient_id=patient.id,
                reason=f"Patient unreachable: {CHECKIN_MAX_ATTEMPTS} scheduled check-in calls were not answered.",
                severity="medium",
                status="open",
            ))
            await db.commit()
            logger.info(f"Plan #{plan.id}: {CHECKIN_MAX_ATTEMPTS} check-ins unanswered; escalated")
        return False

    # Move the due date to the retry time first; a finalized (answered) call moves it on by the interval
    if not await _claim_plan(db, plan, due, now + retry_delay(plan)):
        return False  # someone else got it first
    await db.refresh(plan)
    await dial_checkin(db, plan, patient, attempt)
    return True


async def run_checkin_dialer() -> None:
    """Background loop: place health check-in calls when care plans fall due."""
    logger.info(f"Check-in dialer started (every {settings.scheduler_poll_seconds}s)")
    while True:
        try:
            async with AsyncSessionLocal() as db:
                await dial_due_checkins(db)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error(f"Check-in dialer error: {exc}", exc_info=True)
        await asyncio.sleep(settings.scheduler_poll_seconds)
