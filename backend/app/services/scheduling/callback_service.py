"""Callbacks a caller asks for ("can you call me back?").

Scheduled by the agent during the call or, if it missed the token, from the post-call summary.
When one falls due the dialer loop has the agent call them back; that call is an ordinary
outbound call (so it shows in the call log) linked through CallbackSchedule.call_log_id.
Unanswered callbacks are retried a few times, then marked failed. Staff see them all on the
Call Logs page.
"""
import asyncio
import logging
from datetime import datetime, time, timedelta
from typing import Optional

import twilio.rest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models.call_log import CallLog, DIRECTION_OUTBOUND
from app.models.callback_schedule import (
    CallbackSchedule,
    CALLBACK_CALLING,
    CALLBACK_COMPLETED,
    CALLBACK_FAILED,
    CALLBACK_PENDING,
    DIALLED_SCHEDULE_TYPES,
    SCHEDULE_TYPE_REQUESTED,
    SCHEDULE_TYPE_STAFF,
)
from app.models.patient import Patient
from app.services.scheduling.clinic_scheduling import clinic_now

logger = logging.getLogger(__name__)
settings = get_settings()
twilio_client = twilio.rest.Client(settings.twilio_account_sid, settings.twilio_auth_token)

# Times the agent tries a callback before giving up, and the wait between tries
CALLBACK_MAX_ATTEMPTS = 3
CALLBACK_RETRY_DELAY = timedelta(minutes=15)
# A callback still "calling" this long after dialling never got a final status from Twilio
CALLBACK_STALE_AFTER = timedelta(minutes=30)

# When the caller gives no time ("call me later")
DEFAULT_CALLBACK_DELAY = timedelta(hours=2)


def parse_callback_time(value: Optional[str]) -> Optional[datetime]:
    """Clinic-local callback time from an ISO string; None if missing, invalid or in the past."""
    try:
        when = datetime.fromisoformat((value or "").strip())
    except ValueError:
        return None
    when = when.replace(tzinfo=None, second=0, microsecond=0)
    return when if when > clinic_now() else None


def _hhmm(value: str) -> time:
    hours, minutes = value.split(":")
    return time(int(hours), int(minutes))


def within_calling_hours(when: datetime) -> bool:
    """True if a clinic-local time is inside the hours the agent may call people."""
    return _hhmm(settings.checkin_call_start) <= when.time() <= _hhmm(settings.checkin_call_end)


async def find_requested_callback(db: AsyncSession, call_log_id: int) -> Optional[CallbackSchedule]:
    result = await db.execute(
        select(CallbackSchedule).where(
            CallbackSchedule.source_outreach_call_log_id == call_log_id,
            CallbackSchedule.schedule_type == SCHEDULE_TYPE_REQUESTED,
        )
    )
    return result.scalars().first()


async def schedule_requested_callback(
    db: AsyncSession,
    call: CallLog,
    when: Optional[datetime],
    reason: Optional[str] = None,
    patient_name: Optional[str] = None,
) -> CallbackSchedule:
    """Create (or move) the one callback a call asked for. Caller commits.

    Without a time, a new callback gets the default delay and an existing one keeps its time.
    """
    callback = await find_requested_callback(db, call.id)
    if callback:
        callback.scheduled_time = when or callback.scheduled_time
        callback.notes = reason or callback.notes
        callback.patient_name = patient_name or callback.patient_name
        return callback
    callback = CallbackSchedule(
        patient_id=call.patient_id,
        plan_id=call.plan_id,
        phone_number=call.phone_number,
        patient_name=patient_name,
        scheduled_time=when or clinic_now() + DEFAULT_CALLBACK_DELAY,
        schedule_type=SCHEDULE_TYPE_REQUESTED,
        attempt_number=1,
        max_attempts=CALLBACK_MAX_ATTEMPTS,
        status=CALLBACK_PENDING,
        source_outreach_call_log_id=call.id,
        notes=reason,
    )
    db.add(callback)
    await db.flush()
    return callback


class CallbackBusyError(Exception):
    """The agent is already calling this person back."""


async def schedule_staff_callback(
    db: AsyncSession, call: CallLog, when: datetime, reason: Optional[str] = None
) -> CallbackSchedule:
    """Staff follow-up on a call (from the call log). Moves the call's pending callback if it has one.

    Caller commits.
    """
    result = await db.execute(
        select(CallbackSchedule).where(
            CallbackSchedule.source_outreach_call_log_id == call.id,
            CallbackSchedule.schedule_type.in_(DIALLED_SCHEDULE_TYPES),
            CallbackSchedule.status.in_((CALLBACK_PENDING, CALLBACK_CALLING)),
        )
    )
    callback = result.scalars().first()
    if callback and callback.status == CALLBACK_CALLING:
        raise CallbackBusyError("The agent is already calling this person back")
    if callback:
        callback.scheduled_time = when
        callback.notes = reason or callback.notes
        return callback
    callback = CallbackSchedule(
        patient_id=call.patient_id,
        plan_id=call.plan_id,
        phone_number=call.phone_number,
        patient_name=call.patient_name,
        scheduled_time=when,
        schedule_type=SCHEDULE_TYPE_STAFF,
        attempt_number=1,
        max_attempts=CALLBACK_MAX_ATTEMPTS,
        status=CALLBACK_PENDING,
        source_outreach_call_log_id=call.id,
        notes=reason,
    )
    db.add(callback)
    await db.flush()
    return callback


async def find_callback_for_call(db: AsyncSession, call_log_id: int) -> Optional[CallbackSchedule]:
    """The callback a (callback) call was placed for, if any."""
    result = await db.execute(select(CallbackSchedule).where(CallbackSchedule.call_log_id == call_log_id))
    return result.scalars().first()


async def find_source_call(db: AsyncSession, callback: CallbackSchedule) -> Optional[CallLog]:
    """The call during which the caller asked to be called back."""
    if not callback.source_outreach_call_log_id:
        return None
    return await db.get(CallLog, callback.source_outreach_call_log_id)


# ---------- Outcome of a callback call ----------

def _record_missed_attempt(callback: CallbackSchedule) -> None:
    """Nobody answered: try again later, or give up after the last attempt. Caller commits."""
    if callback.attempt_number >= callback.max_attempts:
        callback.status = CALLBACK_FAILED
        return
    callback.attempt_number += 1
    callback.scheduled_time = clinic_now() + CALLBACK_RETRY_DELAY
    callback.status = CALLBACK_PENDING


async def mark_callback_call_ended(db: AsyncSession, call: CallLog, answered: bool) -> None:
    """Settle the callback this call was placed for (no-op for other calls). Caller commits."""
    callback = await find_callback_for_call(db, call.id)
    if not callback or callback.status != CALLBACK_CALLING:
        return
    if answered:
        callback.status = CALLBACK_COMPLETED
    else:
        _record_missed_attempt(callback)
    logger.info(f"Callback #{callback.id} -> {callback.status} (call #{call.id}, answered={answered})")


# ---------- Dialling ----------

def twilio_configured() -> bool:
    return bool(settings.twilio_account_sid and settings.twilio_auth_token and settings.twilio_phone_number)


async def place_agent_call(to: str) -> str:
    """Have Twilio dial `to` with the agent on the line. Returns the call SID."""
    base = settings.api_base_url.rstrip("/")
    twilio_call = await asyncio.to_thread(
        twilio_client.calls.create,
        from_=settings.twilio_phone_number,
        to=to,
        url=f"{base}/twilio/twiml",
        method="POST",
        # Needed to notice a call nobody answered
        status_callback=f"{base}/twilio/status",
        status_callback_method="POST",
        record=settings.call_recording_enabled,
        timeout=30,
    )
    return twilio_call.sid


async def start_call_recording(call_sid: Optional[str]) -> None:
    """Start recording a call that is already connected (inbound calls can only be recorded this way)."""
    # Only real Twilio calls (CallSid "CA...") can be recorded; direct browser tests ("SIM...") cannot.
    # Only the account credentials are needed (browser calls work without a Twilio phone number).
    if not call_sid or not call_sid.startswith("CA") or not (settings.twilio_account_sid and settings.twilio_auth_token):
        return
    try:
        await asyncio.to_thread(twilio_client.calls(call_sid).recordings.create)
        logger.info(f"[{call_sid}] Recording started")
    except Exception as exc:
        logger.warning(f"[{call_sid}] Could not start recording: {exc}")


async def claim_callback(db: AsyncSession, callback_id: int) -> bool:
    """Atomically move a pending callback to "calling" so it is dialled only once."""
    result = await db.execute(
        update(CallbackSchedule)
        .where(CallbackSchedule.id == callback_id, CallbackSchedule.status == CALLBACK_PENDING)
        .values(status=CALLBACK_CALLING)
    )
    await db.commit()
    return result.rowcount == 1


async def dial_callback(db: AsyncSession, callback: CallbackSchedule) -> CallLog:
    """Have the agent call back a claimed callback. The new call goes in the call log."""
    await db.refresh(callback)
    patient = await db.get(Patient, callback.patient_id) if callback.patient_id else None
    phone_number = callback.phone_number or (patient.phone_number if patient else None)

    call = CallLog(
        direction=DIRECTION_OUTBOUND,
        phone_number=phone_number,
        patient_id=callback.patient_id,
        plan_id=callback.plan_id,
        patient_name=callback.patient_name,
        channel="voice",
        status="initiated",
        attempt_number=callback.attempt_number,
        is_retry=callback.attempt_number > 1,
    )
    db.add(call)
    await db.flush()
    callback.call_log_id = call.id
    callback.status = CALLBACK_CALLING

    if not phone_number:
        call.status = "failed"
        callback.status = CALLBACK_FAILED
        logger.warning(f"Callback #{callback.id} has no phone number")
    elif not twilio_configured():
        # Same mock as POST /api/calls when Twilio is not configured
        logger.warning(f"Twilio not configured - mock callback call for callback #{callback.id}")
        call.status = "completed"
        call.call_sid = f"SM_mock_{call.id}"
        call.transcript = "[Mock call - Twilio not configured]"
        call.duration_seconds = 0
        callback.status = CALLBACK_COMPLETED
    else:
        try:
            call.call_sid = await place_agent_call(phone_number)
            logger.info(f"Callback #{callback.id}: dialling {phone_number} (call #{call.id}, {call.call_sid})")
        except Exception as exc:
            logger.error(f"Callback #{callback.id}: dialling failed: {exc}")
            call.status = "failed"
            call.ended_at = datetime.utcnow()
            _record_missed_attempt(callback)

    await db.commit()
    return call


async def _expire_stale_calls(db: AsyncSession) -> None:
    """Callbacks stuck in "calling" (no final status ever arrived) count as a missed attempt."""
    cutoff = datetime.utcnow() - CALLBACK_STALE_AFTER
    result = await db.execute(
        select(CallbackSchedule, CallLog)
        .join(CallLog, CallLog.id == CallbackSchedule.call_log_id)
        .where(CallbackSchedule.status == CALLBACK_CALLING, CallLog.created_at < cutoff)
    )
    for callback, call in result.all():
        if call.status == "in-progress":
            continue  # still on the line; finalizing the call settles it
        _record_missed_attempt(callback)
        logger.info(f"Callback #{callback.id} had no final call status; now {callback.status}")
    await db.commit()


async def dial_due_callbacks(db: AsyncSession) -> int:
    """Dial every pending callback whose time has come. Returns how many were dialled."""
    await _expire_stale_calls(db)
    result = await db.execute(
        select(CallbackSchedule.id)
        .where(
            CallbackSchedule.schedule_type.in_(DIALLED_SCHEDULE_TYPES),
            CallbackSchedule.status == CALLBACK_PENDING,
            CallbackSchedule.scheduled_time <= clinic_now(),
        )
        .order_by(CallbackSchedule.scheduled_time)
    )
    dialled = 0
    for callback_id in result.scalars().all():
        if not await claim_callback(db, callback_id):
            continue  # someone else (another worker, or "Call now") got it first
        callback = await db.get(CallbackSchedule, callback_id)
        try:
            await dial_callback(db, callback)
            dialled += 1
        except Exception as exc:
            logger.error(f"Callback #{callback_id}: {exc}", exc_info=True)
            await db.rollback()
    return dialled


async def run_callback_dialer() -> None:
    """Background loop: call people back when their callback falls due."""
    logger.info(f"Callback dialer started (every {settings.callback_poll_seconds}s)")
    while True:
        try:
            async with AsyncSessionLocal() as db:
                await dial_due_callbacks(db)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error(f"Callback dialer error: {exc}", exc_info=True)
        await asyncio.sleep(settings.callback_poll_seconds)
