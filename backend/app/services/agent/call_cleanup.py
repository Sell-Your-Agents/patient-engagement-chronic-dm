"""Close call logs that were left "live" after the call actually ended.

A call is finalized when its media stream ends. That step can be skipped if the
backend restarts mid-call, if call setup fails, or if finalizing raises. Without
this cleanup such calls stay "in-progress" forever and show up as live calls.
"""

import logging
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.call_log import CallLog

logger = logging.getLogger(__name__)

LIVE_STATUSES = ("initiated", "ringing", "in-progress", "in_progress", "calling")
# No real call lasts this long; anything still "live" past it has ended without a final status.
STALE_AFTER = timedelta(minutes=30)
BROWSER_SID_PREFIX = "SIM"


def _close(call: CallLog, now: datetime) -> None:
    started = call.started_at or call.created_at
    call.ended_at = call.ended_at or now
    # Unknown real length: keep the duration empty rather than reporting hours of "call"
    if call.status in ("in-progress", "in_progress") and started and call.ended_at - started <= STALE_AFTER:
        call.duration_seconds = int((call.ended_at - started).total_seconds())
    # Answered but never finalized = "completed"; never answered = "failed"
    call.status = "completed" if call.status in ("in-progress", "in_progress") else "failed"


async def close_stale_calls(db: AsyncSession, *, browser_only_any_age: bool = False) -> int:
    """Close live-looking calls older than STALE_AFTER.

    With browser_only_any_age=True (used at startup) every direct browser test call that is
    still "live" is closed regardless of age: its websocket cannot survive a backend restart.
    """
    now = datetime.utcnow()
    cutoff = now - STALE_AFTER
    conditions = [CallLog.created_at < cutoff]
    if browser_only_any_age:
        conditions.append(CallLog.call_sid.like(f"{BROWSER_SID_PREFIX}%"))
    result = await db.execute(select(CallLog).where(CallLog.status.in_(LIVE_STATUSES), or_(*conditions)))
    calls = list(result.scalars().all())
    for call in calls:
        old = call.status
        _close(call, now)
        logger.info(f"Call #{call.id} ({call.call_sid}) was still '{old}' with no final status; marked {call.status}")
    if calls:
        await db.commit()
    return len(calls)


async def close_call_now(db: AsyncSession, call_id: Optional[int] = None, call_sid: Optional[str] = None) -> None:
    """Last-resort close for one call when finalizing failed or the call never got going."""
    try:
        await db.rollback()
        query = select(CallLog).where(CallLog.id == call_id) if call_id else select(CallLog).where(CallLog.call_sid == call_sid)
        call = (await db.execute(query)).scalar_one_or_none()
        if call and call.status in LIVE_STATUSES:
            _close(call, datetime.utcnow())
            await db.commit()
            logger.info(f"Call #{call.id} closed as {call.status} after an incomplete finalize")
    except Exception as exc:
        logger.error(f"Could not close call {call_id or call_sid}: {exc}", exc_info=True)
