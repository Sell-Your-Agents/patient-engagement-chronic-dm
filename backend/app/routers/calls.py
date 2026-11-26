"""Call records: every call the agent answered, with its structured record and transcript."""
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.database import get_db
from app.models.appointment import Appointment
from app.models.call_log import CallLog, CallTurn, call_ref
from app.models.callback_schedule import FollowUp
from app.models.patient import Patient
from app.models.user import User
from app.services.voice.call_recorder import recording_path

router = APIRouter(prefix="/api/calls", tags=["calls"])


class CallResponse(BaseModel):
    id: int
    call_ref: str
    channel: str
    phone_number: Optional[str]
    patient_id: Optional[int]
    patient_name: Optional[str]
    # The saved patient's name (same on every call from that patient); null for unknown callers
    patient_saved_name: Optional[str] = None
    status: str
    language: Optional[str]
    intent: Optional[str]
    doctor_requested: Optional[str]
    preferred_slot: Optional[str]
    reason: Optional[str]
    outcome: Optional[str]
    booking_status: Optional[str]
    next_action: Optional[str]
    urgency: Optional[str]
    summary: Optional[str]
    started_at: Optional[datetime]
    ended_at: Optional[datetime]
    duration_seconds: Optional[int]
    created_at: datetime
    # Set when the call was recorded: GET /api/calls/{id}/recording plays it
    recording_url: Optional[str] = None

    class Config:
        from_attributes = True


class CallTurnResponse(BaseModel):
    role: str
    content: str
    timestamp: datetime

    class Config:
        from_attributes = True


class LinkedItem(BaseModel):
    id: int
    kind: str
    status: str
    label: str
    # One line for staff, e.g. "Dr. Ramesh Agarwal · Tue 17 Nov, 05:00 PM" or the follow-up's reason
    detail: Optional[str] = None
    # Follow-ups only: what kind and how urgent
    follow_up_kind: Optional[str] = None
    priority: Optional[str] = None
    transfer_status: Optional[str] = None


class CallDetailResponse(CallResponse):
    transcript: Optional[str]
    structured_summary: Optional[dict]
    recording_url: Optional[str]
    turns: List[CallTurnResponse] = []
    linked: List[LinkedItem] = []


class CallPage(BaseModel):
    items: List[CallResponse]
    total: int
    page: int
    page_size: int


def _as_utc_naive(value: Optional[datetime]) -> Optional[datetime]:
    """Call timestamps are stored as naive UTC; accept aware or naive input."""
    if value is None:
        return None
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


@router.get("/", response_model=CallPage)
async def search_calls(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    q: Optional[str] = Query(None, max_length=120, description="Name, phone number or call ID (SS-1001)"),
    intent: Optional[str] = Query(None, max_length=30),
    language: Optional[str] = Query(None, pattern="^(en|hi|te)$"),
    booking_status: Optional[str] = Query(None, pattern="^(confirmed|pending|not_applicable)$"),
    patient_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None, max_length=20),
    finished_only: bool = Query(False, description="Leave out calls still in progress"),
    date_from: Optional[datetime] = Query(None, description="Calls at or after this time (ISO 8601)"),
    date_to: Optional[datetime] = Query(None, description="Calls before this time (ISO 8601)"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Call records, newest first, paged on the server."""
    when = func.coalesce(CallLog.started_at, CallLog.created_at)
    filters = []
    start, end = _as_utc_naive(date_from), _as_utc_naive(date_to)
    if start:
        filters.append(when >= start)
    if end:
        filters.append(when < end)
    if q and q.strip():
        term = q.strip()
        conditions = [CallLog.patient_name.ilike(f"%{term}%")]
        digits = "".join(ch for ch in term if ch.isdigit())
        if digits:
            conditions.append(CallLog.phone_number.like(f"%{digits}%"))
        if term.upper().startswith("SS-") and digits:
            conditions.append(CallLog.id == int(digits) - 1000)
        filters.append(or_(*conditions))
    if intent:
        filters.append(CallLog.intent == intent)
    if language:
        filters.append(CallLog.language == language)
    if booking_status:
        filters.append(CallLog.booking_status == booking_status)
    if patient_id:
        filters.append(CallLog.patient_id == patient_id)
    if status:
        filters.append(CallLog.status == status)
    if finished_only:
        filters.append(CallLog.status != "in-progress")

    total = (await db.execute(select(func.count(CallLog.id)).where(*filters))).scalar() or 0
    result = await db.execute(
        select(CallLog).where(*filters).order_by(when.desc(), CallLog.id.desc()).offset((page - 1) * page_size).limit(page_size)
    )
    calls = list(result.scalars().all())
    names = await _saved_names(db, calls)
    items = []
    for c in calls:
        item = CallResponse.model_validate(c)
        item.patient_saved_name = names.get(c.patient_id)
        items.append(item)
    return {"items": items, "total": total, "page": page, "page_size": page_size}


async def _saved_names(db: AsyncSession, calls) -> dict:
    ids = {c.patient_id for c in calls if c.patient_id}
    if not ids:
        return {}
    rows = await db.execute(select(Patient.id, Patient.name).where(Patient.id.in_(ids)))
    return {pid: name for pid, name in rows.all()}


@router.get("/live", response_model=List[CallResponse])
async def live_calls(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    """Calls in progress right now."""
    result = await db.execute(select(CallLog).where(CallLog.status == "in-progress").order_by(CallLog.id.desc()).limit(50))
    calls = list(result.scalars().all())
    names = await _saved_names(db, calls)
    items = [CallResponse.model_validate(c) for c in calls]
    for item in items:
        item.patient_saved_name = names.get(item.patient_id)
    return items


@router.get("/by-sid/{call_sid}", response_model=CallResponse)
async def call_by_sid(call_sid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    """Find a call by its Twilio CallSid (the browser test page only knows the SID)."""
    call = (await db.execute(select(CallLog).where(CallLog.call_sid == call_sid))).scalar_one_or_none()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    return call


@router.get("/{call_log_id}", response_model=CallDetailResponse)
async def get_call(call_log_id: int, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    call = await db.get(CallLog, call_log_id)
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    turns = await db.execute(
        select(CallTurn).where(CallTurn.call_log_id == call_log_id).order_by(CallTurn.timestamp, CallTurn.id)
    )
    detail = CallDetailResponse.model_validate(call)
    detail.patient_saved_name = (await _saved_names(db, [call])).get(call.patient_id)
    detail.turns = [CallTurnResponse.model_validate(t) for t in turns.scalars().all()]

    linked: List[LinkedItem] = []
    for a in (await db.execute(select(Appointment).where(Appointment.call_log_id == call_log_id))).scalars().all():
        when = a.start_at.strftime("%a %d %b, %I:%M %p") if a.start_at else (a.preferred_time or "time not set")
        linked.append(LinkedItem(
            id=a.id, kind="appointment", status=a.status, label=f"Appointment request #{a.id}",
            detail=f"{a.doctor_display_name} · {when}",
        ))
    for f in (await db.execute(select(FollowUp).where(FollowUp.call_log_id == call_log_id))).scalars().all():
        linked.append(LinkedItem(
            id=f.id, kind="follow_up", status=f.status, label=f"Follow-up #{f.id}",
            detail=f.reason or f.preferred_time, follow_up_kind=f.kind, priority=f.priority, transfer_status=f.transfer_status,
        ))
    detail.linked = linked
    return detail



@router.get("/{call_log_id}/recording")
async def call_recording(call_log_id: int, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    """The call's recording (WAV), for signed-in clinic staff only."""
    call = await db.get(CallLog, call_log_id)
    path = recording_path(call_log_id)
    if not call or not call.recording_url or not path.is_file():
        raise HTTPException(status_code=404, detail="No recording for this call")
    return FileResponse(path, media_type="audio/wav", filename=f"{call_ref(call_log_id)}.wav")
