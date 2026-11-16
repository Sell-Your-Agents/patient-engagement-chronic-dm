"""Notifications for the bell in the header.

Built live from the records that need staff attention, so nothing can go stale:
  * Clinical alerts   - escalations that are open or acknowledged, plus a reminder when one
                        stays unacknowledged too long for its severity
  * Callbacks         - callbacks that are due now, and callbacks nobody answered (failed)
  * Appointments      - appointment requests waiting to be confirmed

Read/unread is stored per user in notification_reads.
"""
from datetime import datetime, timedelta, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.config import get_settings
from app.database import get_db
from app.models.appointment import Appointment
from app.models.callback_schedule import CALLBACK_FAILED, CALLBACK_PENDING, CallbackSchedule
from app.models.escalation import Escalation
from app.models.notification import NotificationClear, NotificationRead
from app.models.patient import Patient
from app.models.user import User

router = APIRouter(prefix="/api/notifications", tags=["notifications"])
settings = get_settings()

# How long an escalation may stay unacknowledged before a reminder appears
ACK_DEADLINE = {
    "urgent": timedelta(minutes=15),
    "critical": timedelta(minutes=15),
    "high": timedelta(hours=1),
    "medium": timedelta(hours=4),
    "low": timedelta(hours=24),
}
# Failed callbacks and acknowledged escalations stop showing after this long
LOOKBACK = timedelta(days=14)
MAX_ITEMS = 60


class Notification(BaseModel):
    key: str
    group: Literal["clinical", "callback", "appointment"]
    kind: str
    severity: Literal["urgent", "high", "medium", "low", "info"]
    title: str
    body: str
    #: UTC, ISO 8601
    at: datetime
    link: str
    #: The record an inline action works on
    ref_id: int
    action: Optional[Literal["acknowledge", "call_now", "confirm"]] = None
    needs_action: bool
    read: bool


class NotificationList(BaseModel):
    items: List[Notification]
    unread: int
    unread_needs_action: int


class MarkRead(BaseModel):
    keys: List[str] = Field(default_factory=list, max_length=200)


def _clinic_to_utc(local: datetime) -> datetime:
    """Callback and appointment times are naive clinic-local; convert to naive UTC."""
    return local - timedelta(minutes=settings.clinic_utc_offset_minutes)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def _build(db: AsyncSession, user: User) -> List[Notification]:
    now = _utc_now()
    since = now - LOOKBACK
    items: List[dict] = []

    # Patient names for escalations (escalations only store patient_id)
    names = {p.id: f"{p.first_name} {p.last_name}" for p in (await db.execute(select(Patient))).scalars()}

    # ---- Clinical alerts ----
    escalations = (
        await db.execute(
            select(Escalation)
            .where(Escalation.status.in_(("open", "acknowledged")))
            .order_by(Escalation.created_at.desc())
        )
    ).scalars().all()
    for e in escalations:
        sev = (e.severity or "medium").lower()
        sev = sev if sev in ("urgent", "high", "medium", "low") else ("urgent" if sev == "critical" else "medium")
        who = names.get(e.patient_id, "New caller") if e.patient_id else "New caller"
        is_open = e.status == "open"
        if e.status == "acknowledged" and e.created_at < since:
            continue
        deadline = ACK_DEADLINE.get(sev, ACK_DEADLINE["medium"])
        if is_open and now - e.created_at > deadline:
            # One item per escalation: once overdue, the reminder replaces the original alert
            # (new key, so it shows as unread again even if the first alert was read)
            items.append(
                dict(
                    key=f"esc:{e.id}:overdue",
                    group="clinical",
                    kind="escalation_overdue",
                    severity=sev,
                    title=f"Not acknowledged · {who}",
                    body=f"{e.reason} · waiting more than {_human(deadline)}",
                    at=e.created_at + deadline,
                    link=f"/escalations/{e.id}",
                    ref_id=e.id,
                    action="acknowledge",
                    needs_action=True,
                )
            )
            continue
        items.append(
            dict(
                key=f"esc:{e.id}:raised",
                group="clinical",
                kind="escalation",
                severity=sev,
                title=f"{sev.capitalize()} escalation · {who}",
                body=e.reason,
                at=e.created_at,
                link=f"/escalations/{e.id}",
                ref_id=e.id,
                action="acknowledge" if is_open else None,
                needs_action=is_open,
            )
        )

    # ---- Callbacks ----
    callbacks = (
        await db.execute(
            select(CallbackSchedule).where(CallbackSchedule.status.in_((CALLBACK_PENDING, CALLBACK_FAILED)))
        )
    ).scalars().all()
    for cb in callbacks:
        who = cb.patient_name or cb.phone_number or f"Callback {cb.id}"
        due_utc = _clinic_to_utc(cb.scheduled_time)
        if cb.status == CALLBACK_PENDING and due_utc <= now:
            items.append(
                dict(
                    key=f"cb:{cb.id}:due",
                    group="callback",
                    kind="callback_due",
                    severity="high",
                    title=f"Callback due · {who}",
                    body=cb.notes or ("Retry after a missed check-in" if cb.schedule_type == "retry" else "Asked to be called back"),
                    at=due_utc,
                    link="/calls",
                    ref_id=cb.id,
                    action="call_now",
                    needs_action=True,
                )
            )
        elif cb.status == CALLBACK_FAILED and due_utc >= since:
            items.append(
                dict(
                    key=f"cb:{cb.id}:failed",
                    group="callback",
                    kind="callback_failed",
                    severity="high",
                    title=f"Couldn't reach · {who}",
                    body=f"No answer after {cb.max_attempts} tries. Please call them.",
                    at=due_utc,
                    link="/calls",
                    ref_id=cb.id,
                    action=None,
                    needs_action=True,
                )
            )

    # ---- Appointment requests ----
    requests = (await db.execute(select(Appointment).where(Appointment.status == "requested"))).scalars().all()
    for a in requests:
        when = a.start_at.strftime("%a %d %b, %I:%M %p").replace(" 0", " ") if a.start_at else "time to be agreed"
        items.append(
            dict(
                key=f"appt:{a.id}:requested",
                group="appointment",
                kind="appointment_request",
                severity="medium",
                title=f"Appointment request · {a.patient_name}",
                body=f"{a.physician_name or 'Doctor'} · {when}" + (f" · {a.reason}" if a.reason else ""),
                at=a.created_at,
                link="/appointments",
                ref_id=a.id,
                action="confirm",
                needs_action=True,
            )
        )

    read_keys = set(
        (await db.execute(select(NotificationRead.key).where(NotificationRead.user_id == user.id))).scalars().all()
    )
    cleared = set(
        (await db.execute(select(NotificationClear.key).where(NotificationClear.user_id == user.id))).scalars().all()
    )
    items = [i for i in items if i["key"] not in cleared]
    items.sort(key=lambda i: i["at"], reverse=True)
    return [Notification(**i, read=i["key"] in read_keys) for i in items[:MAX_ITEMS]]


def _human(delta: timedelta) -> str:
    minutes = int(delta.total_seconds() // 60)
    return f"{minutes} min" if minutes < 60 else f"{minutes // 60} h"


@router.get("/", response_model=NotificationList)
async def list_notifications(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    items = await _build(db, user)
    unread = [n for n in items if not n.read]
    return {"items": items, "unread": len(unread), "unread_needs_action": sum(1 for n in unread if n.needs_action)}


async def _store(db: AsyncSession, user: User, keys: List[str], model, constraint: str) -> None:
    keys = [k for k in dict.fromkeys(keys) if k and len(k) <= 64]
    if not keys:
        return
    stmt = pg_insert(model).values([{"user_id": user.id, "key": k} for k in keys])
    await db.execute(stmt.on_conflict_do_nothing(constraint=constraint))


async def _mark(db: AsyncSession, user: User, keys: List[str]) -> None:
    await _store(db, user, keys, NotificationRead, "uq_notification_read_user_key")
    await db.commit()


async def _clear(db: AsyncSession, user: User, keys: List[str]) -> None:
    # Clearing also counts as reading
    await _store(db, user, keys, NotificationRead, "uq_notification_read_user_key")
    await _store(db, user, keys, NotificationClear, "uq_notification_clear_user_key")
    await db.commit()


@router.post("/read", status_code=204)
async def mark_read(body: MarkRead, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await _mark(db, user, body.keys)


@router.post("/read-all", status_code=204)
async def mark_all_read(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await _mark(db, user, [n.key for n in await _build(db, user)])


@router.post("/clear", status_code=204)
async def clear(body: MarkRead, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Remove notifications from this user's list. Nothing clinical changes."""
    await _clear(db, user, body.keys)


@router.post("/clear-all", status_code=204)
async def clear_all(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await _clear(db, user, [n.key for n in await _build(db, user)])
