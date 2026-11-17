"""Follow-ups: the one list of people clinic staff must call back (emergencies, wants staff,
couldn't answer, callbacks, appointment confirmations)."""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import case, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.database import get_db
from app.models.call_log import call_ref
from app.models.callback_schedule import (
    FOLLOWUP_DONE,
    FOLLOWUP_PENDING,
    FOLLOWUP_STATUSES,
    KIND_STAFF,
    PRIORITY_HIGH,
    PRIORITY_URGENT,
    FollowUp,
)
from app.models.user import User
from app.routers.clinic import normalize_phone
from app.services.agent.context_shared import lookup_caller
from app.services.scheduling.callback_service import create_follow_up

router = APIRouter(prefix="/api/follow-ups", tags=["follow-ups"])

STATUS_PATTERN = "^(" + "|".join(FOLLOWUP_STATUSES) + ")$"


class FollowUpResponse(BaseModel):
    id: int
    kind: str
    priority: str
    transfer_status: Optional[str]
    call_log_id: Optional[int]
    call_ref: Optional[str]
    appointment_id: Optional[int]
    patient_id: Optional[int]
    patient_name: Optional[str]
    phone_number: Optional[str]
    doctor_requested: Optional[str]
    preferred_time: Optional[str]
    reason: Optional[str]
    follow_up_at: Optional[datetime]
    status: str
    staff_notes: Optional[str]
    completed_at: Optional[datetime]
    created_at: datetime


def follow_up_out(task: FollowUp) -> FollowUpResponse:
    return FollowUpResponse(
        id=task.id,
        kind=task.kind,
        priority=task.priority or "normal",
        transfer_status=task.transfer_status,
        call_log_id=task.call_log_id,
        call_ref=call_ref(task.call_log_id) if task.call_log_id else None,
        appointment_id=task.appointment_id,
        patient_id=task.patient_id,
        patient_name=task.patient_name,
        phone_number=task.phone_number,
        doctor_requested=task.doctor_requested,
        preferred_time=task.preferred_time,
        reason=task.reason,
        follow_up_at=task.follow_up_at,
        status=task.status,
        staff_notes=task.staff_notes,
        completed_at=task.completed_at,
        created_at=task.created_at,
    )


@router.get("/", response_model=List[FollowUpResponse])
async def list_follow_ups(
    status: Optional[str] = Query(None, pattern=STATUS_PATTERN),
    kind: Optional[str] = Query(None, max_length=30),
    limit: int = Query(500, ge=1, le=2000),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Pending first: urgent, then high, then normal, oldest first in each; then finished ones, newest first."""
    query = select(FollowUp)
    if status:
        query = query.where(FollowUp.status == status)
    if kind:
        query = query.where(FollowUp.kind == kind)
    pending_first = case((FollowUp.status == FOLLOWUP_PENDING, 0), else_=1)
    result = await db.execute(query.order_by(pending_first, FollowUp.created_at.desc()).limit(limit))
    tasks = list(result.scalars().all())
    rank = {PRIORITY_URGENT: 0, PRIORITY_HIGH: 1}
    pending = sorted((t for t in tasks if t.status == FOLLOWUP_PENDING), key=lambda t: (rank.get(t.priority, 2), t.created_at))
    return [follow_up_out(t) for t in pending + [t for t in tasks if t.status != FOLLOWUP_PENDING]]


class FollowUpCreate(BaseModel):
    patient_name: str = Field(min_length=1, max_length=120)
    phone_number: str = Field(min_length=6, max_length=20)
    reason: Optional[str] = Field(None, max_length=500)
    doctor_requested: Optional[str] = Field(None, max_length=120)
    preferred_time: Optional[str] = Field(None, max_length=120)
    follow_up_at: Optional[datetime] = None
    priority: str = Field("normal", pattern="^(urgent|high|normal)$")


@router.post("/", response_model=FollowUpResponse, status_code=201)
async def add_follow_up(data: FollowUpCreate, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    phone = normalize_phone(data.phone_number)
    patient = await lookup_caller(db, phone)
    task = await create_follow_up(
        db,
        kind=KIND_STAFF,
        priority=data.priority,
        patient_id=patient.id if patient else None,
        patient_name=data.patient_name.strip(),
        phone_number=phone,
        doctor_requested=data.doctor_requested,
        preferred_time=data.preferred_time,
        reason=data.reason,
        follow_up_at=data.follow_up_at.replace(tzinfo=None) if data.follow_up_at else None,
    )
    await db.commit()
    return follow_up_out(task)


class FollowUpUpdate(BaseModel):
    status: Optional[str] = Field(None, pattern=STATUS_PATTERN)
    staff_notes: Optional[str] = Field(None, max_length=2000)
    follow_up_at: Optional[datetime] = None


@router.patch("/{task_id}", response_model=FollowUpResponse)
async def update_follow_up(
    task_id: int, data: FollowUpUpdate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    task = await db.get(FollowUp, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    if data.status and data.status != task.status:
        task.status = data.status
        if data.status == FOLLOWUP_DONE:
            task.completed_at = datetime.utcnow()
            task.completed_by_user_id = user.id
        elif data.status == FOLLOWUP_PENDING:
            task.completed_at = None
            task.completed_by_user_id = None
    if data.staff_notes is not None:
        task.staff_notes = data.staff_notes
    if data.follow_up_at is not None:
        task.follow_up_at = data.follow_up_at.replace(tzinfo=None)
    await db.commit()
    await db.refresh(task)
    return follow_up_out(task)
