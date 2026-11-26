"""Notifications for the bell in the header.

Built live from the records that need staff attention, so nothing can go stale:
  * Follow-ups    - people waiting for a call back (urgent ones first), plus a reminder when an
                    urgent / high one waits too long
  * Appointments  - appointment requests pending confirmation

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
from app.models.appointment import STATUS_PENDING, Appointment
from app.models.callback_schedule import FOLLOWUP_PENDING, KIND_CONFIRM_APPOINTMENT, FollowUp
from app.models.notification import NotificationClear, NotificationRead
from app.models.user import User

router = APIRouter(prefix="/api/notifications", tags=["notifications"])
settings = get_settings()

# How long an urgent / high follow-up may wait before a reminder appears
REMIND_AFTER = {"urgent": timedelta(minutes=15), "high": timedelta(hours=1)}
MAX_ITEMS = 60
KIND_LABELS = {
    "emergency": "Emergency: given the emergency number",
    "distress": "Caller in distress",
    "human_assistance": "Asked for staff",
    "unanswered_question": "Question not answered",
    "callback": "Callback requested",
    "staff": "Added by staff",
}
SEVERITY = {"urgent": "urgent", "high": "high", "normal": "medium"}


class Notification(BaseModel):
    key: str
    group: Literal["followup", "appointment"]
    kind: str
    severity: Literal["urgent", "high", "medium", "low", "info"]
    title: str
    body: str
    #: UTC, ISO 8601
    at: datetime
    link: str
    #: The record an inline action works on
    ref_id: int
    action: Optional[Literal["done"]] = None
    needs_action: bool
    read: bool


class NotificationList(BaseModel):
    items: List[Notification]
    unread: int
    unread_needs_action: int


class MarkRead(BaseModel):
    keys: List[str] = Field(default_factory=list, max_length=200)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def _build(db: AsyncSession, user: User) -> List[Notification]:
    now = _utc_now()
    items: List[dict] = []

    # ---- Follow-ups (appointment confirmations are shown as appointment requests below) ----
    tasks = (
        await db.execute(
            select(FollowUp).where(FollowUp.status == FOLLOWUP_PENDING, FollowUp.kind != KIND_CONFIRM_APPOINTMENT)
        )
    ).scalars().all()
    for t in tasks:
        who = t.patient_name or t.phone_number or "Caller"
        label = KIND_LABELS.get(t.kind, "Follow-up")
        if t.kind == "human_assistance" and t.transfer_status == "not_answered":
            label = "Asked for staff: no one answered"
        sev = SEVERITY.get(t.priority, "medium")
        details = " · ".join(x for x in (t.reason, t.doctor_requested, t.preferred_time) if x) or "Please call back"
        remind = REMIND_AFTER.get(t.priority)
        if remind and now - t.created_at > remind:
            # Once overdue, the reminder replaces the original alert (new key, so it is unread again)
            items.append(dict(
                key=f"fu:{t.id}:overdue", group="followup", kind="followup_overdue", severity=sev,
                title=f"Still waiting · {label} · {who}", body=f"{details} · waiting more than {_human(remind)}",
                at=t.created_at + remind, link="/follow-ups", ref_id=t.id, action="done", needs_action=True,
            ))
            continue
        items.append(dict(
            key=f"fu:{t.id}:pending", group="followup", kind=t.kind, severity=sev,
            title=f"{label} · {who}", body=details, at=t.created_at,
            link="/follow-ups", ref_id=t.id, action="done", needs_action=True,
        ))

    # ---- Appointment requests ----
    requests = (await db.execute(select(Appointment).where(Appointment.status == STATUS_PENDING))).scalars().all()
    for a in requests:
        when = a.start_at.strftime("%a %d %b, %I:%M %p").replace(" 0", " ") if a.start_at else (a.preferred_time or "time to be agreed")
        items.append(dict(
            key=f"appt:{a.id}:pending", group="appointment", kind="appointment_request", severity="medium",
            title=f"Pending appointment · {a.patient_name}",
            body=f"{a.doctor_requested or 'Doctor'} · {when}" + (f" · {a.reason}" if a.reason else ""),
            at=a.created_at, link="/appointments", ref_id=a.id, action=None, needs_action=True,
        ))

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
