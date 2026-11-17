"""Dashboard numbers: calls, intents, languages, appointment requests and follow-ups."""
from collections import Counter
from datetime import datetime, timedelta
from typing import Dict

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.config import get_settings
from app.database import get_db
from app.models.appointment import STATUS_CONFIRMED, STATUS_PENDING, Appointment
from app.models.call_log import CallLog
from app.models.callback_schedule import FOLLOWUP_PENDING, KIND_CONFIRM_APPOINTMENT, PRIORITY_URGENT, FollowUp
from app.models.patient import Patient
from app.models.user import User

settings = get_settings()
router = APIRouter(prefix="/api/analytics", tags=["analytics"])


def _local(utc: datetime) -> datetime:
    return utc + timedelta(minutes=settings.clinic_utc_offset_minutes)


@router.get("/dashboard")
async def dashboard(
    days: int = Query(14, ge=1, le=90),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> Dict:
    """Everything the dashboard shows, in one request. "Today" and the trend use clinic-local dates."""
    now_utc = datetime.utcnow()
    today = _local(now_utc).date()
    since_utc = datetime.combine(today - timedelta(days=days - 1), datetime.min.time()) - timedelta(
        minutes=settings.clinic_utc_offset_minutes
    )

    async def count(stmt) -> int:
        return (await db.execute(stmt)).scalar() or 0

    rows = (
        await db.execute(
            select(
                CallLog.created_at, CallLog.intent, CallLog.language, CallLog.booking_status, CallLog.status,
                CallLog.duration_seconds, CallLog.next_action,
            )
            .where(CallLog.created_at >= since_utc)
        )
    ).all()

    trend = {today - timedelta(days=offset): {"calls": 0, "requests": 0} for offset in range(days)}
    intents: Counter = Counter()
    languages: Counter = Counter()
    calls_today = 0
    durations = []
    hours: Counter = Counter()
    conversations = 0  # calls where the caller actually talked to Maya
    handled_alone = 0  # ...and nothing was left for staff to do
    transferred = 0
    for created_at, intent, language, booking_status, status, duration, next_action in rows:
        hours[_local(created_at).hour] += 1
        if status == "transferred":
            transferred += 1
        if intent and intent != "other" or status == "transferred":
            conversations += 1
            if status == "completed" and (next_action in (None, "", "None")) and booking_status in (None, "not_applicable", "confirmed"):
                handled_alone += 1
        day = _local(created_at).date()
        if day in trend:
            trend[day]["calls"] += 1
            if booking_status in ("pending", "confirmed"):
                trend[day]["requests"] += 1
        if day == today:
            calls_today += 1
        if intent:
            intents[intent] += 1
        if language:
            languages[language] += 1
        if duration and status in ("completed", "transferred"):
            durations.append(duration)

    follow_ups_period = await count(select(func.count(FollowUp.id)).where(FollowUp.created_at >= since_utc))
    busiest = hours.most_common(1)[0][0] if hours else None

    total_calls = await count(select(func.count(CallLog.id)))
    live_calls = await count(select(func.count(CallLog.id)).where(CallLog.status == "in-progress"))
    pending_appointments = await count(select(func.count(Appointment.id)).where(Appointment.status == STATUS_PENDING))
    confirmed_upcoming = await count(
        select(func.count(Appointment.id)).where(
            Appointment.status == STATUS_CONFIRMED,
            Appointment.start_at >= _local(now_utc).replace(tzinfo=None),
        )
    )
    requests_period = await count(select(func.count(Appointment.id)).where(Appointment.created_at >= since_utc))
    pending_follow_ups = await count(select(func.count(FollowUp.id)).where(FollowUp.status == FOLLOWUP_PENDING))
    urgent_follow_ups = await count(
        select(func.count(FollowUp.id)).where(FollowUp.status == FOLLOWUP_PENDING, FollowUp.priority == PRIORITY_URGENT)
    )
    by_kind_rows = (
        await db.execute(
            select(FollowUp.kind, func.count(FollowUp.id))
            .where(FollowUp.status == FOLLOWUP_PENDING, FollowUp.kind != KIND_CONFIRM_APPOINTMENT)
            .group_by(FollowUp.kind)
        )
    ).all()
    patients = await count(select(func.count(Patient.id)))
    calls_period = len(rows)

    return {
        "days": days,
        "calls_today": calls_today,
        "calls_period": calls_period,
        "total_calls": total_calls,
        "live_calls": live_calls,
        "avg_call_seconds": round(sum(durations) / len(durations)) if durations else None,
        "appointment_requests_period": requests_period,
        "request_rate": round(requests_period / calls_period * 100, 1) if calls_period else 0,
        "pending_appointments": pending_appointments,
        "confirmed_upcoming": confirmed_upcoming,
        "pending_follow_ups": pending_follow_ups,
        "urgent_follow_ups": urgent_follow_ups,
        # Waiting follow-ups by kind (appointment confirmations are counted in pending_appointments)
        "follow_ups_by_kind": {kind: n for kind, n in by_kind_rows},
        "patients": patients,
        # About the AI agent, last `days` days
        "agent": {
            "conversations": conversations,
            "handled_alone": handled_alone,
            "handled_alone_rate": round(handled_alone / conversations * 100) if conversations else 0,
            "transferred": transferred,
            "follow_ups_created": follow_ups_period,
            "busiest_hour": busiest,
        },
        "intents": dict(intents),
        "languages": dict(languages),
        "trend": [
            {"date": day.isoformat(), "calls": trend[day]["calls"], "requests": trend[day]["requests"]}
            for day in sorted(trend)
        ],
    }
