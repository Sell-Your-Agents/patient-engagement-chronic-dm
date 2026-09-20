from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from datetime import datetime
from typing import List, Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user
from app.models.care_team_user import CareTeamUser
from app.models.medication_reminder import MedicationReminder

router = APIRouter(prefix="/api/medication-reminders", tags=["medication_reminders"])


class MedicationReminderResponse(BaseModel):
    id: int
    patient_id: int
    care_plan_id: Optional[int]
    medication_name: str
    refill_due_date: datetime
    status: str
    reminder_sent_count: int
    created_at: datetime

    class Config:
        from_attributes = True


class MedicationReminderCreateRequest(BaseModel):
    patient_id: int
    care_plan_id: Optional[int] = None
    medication_name: str
    refill_due_date: datetime


class MedicationReminderUpdateRequest(BaseModel):
    status: Optional[str] = None
    refill_due_date: Optional[datetime] = None


@router.get("/", response_model=List[MedicationReminderResponse])
async def list_medication_reminders(
    db: AsyncSession = Depends(get_db),
    _: CareTeamUser = Depends(get_current_user),
    patient_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
) -> List[MedicationReminderResponse]:
    """List medication reminders with optional filters."""
    query = select(MedicationReminder)

    if patient_id:
        query = query.where(MedicationReminder.patient_id == patient_id)

    if status:
        query = query.where(MedicationReminder.status == status)

    query = query.offset(skip).limit(limit)
    result = await db.execute(query)
    reminders = result.scalars().all()

    return [MedicationReminderResponse.model_validate(reminder) for reminder in reminders]


@router.post("/", response_model=MedicationReminderResponse, status_code=201)
async def create_medication_reminder(
    request: MedicationReminderCreateRequest,
    db: AsyncSession = Depends(get_db),
    _: CareTeamUser = Depends(get_current_user),
) -> MedicationReminderResponse:
    """Create a medication reminder."""
    reminder = MedicationReminder(
        patient_id=request.patient_id,
        care_plan_id=request.care_plan_id,
        medication_name=request.medication_name,
        refill_due_date=request.refill_due_date,
        status="upcoming",
    )
    db.add(reminder)
    await db.commit()
    await db.refresh(reminder)

    return MedicationReminderResponse.model_validate(reminder)


@router.get("/{id}", response_model=MedicationReminderResponse)
async def get_medication_reminder(
    id: int,
    db: AsyncSession = Depends(get_db),
    _: CareTeamUser = Depends(get_current_user),
) -> MedicationReminderResponse:
    """Get medication reminder details."""
    result = await db.execute(
        select(MedicationReminder).where(MedicationReminder.id == id)
    )
    reminder = result.scalar_one_or_none()

    if not reminder:
        raise HTTPException(status_code=404, detail="Medication reminder not found")

    return MedicationReminderResponse.model_validate(reminder)


@router.patch("/{id}", response_model=MedicationReminderResponse)
async def update_medication_reminder(
    id: int,
    request: MedicationReminderUpdateRequest,
    db: AsyncSession = Depends(get_db),
    _: CareTeamUser = Depends(get_current_user),
) -> MedicationReminderResponse:
    """Update a medication reminder."""
    result = await db.execute(
        select(MedicationReminder).where(MedicationReminder.id == id)
    )
    reminder = result.scalar_one_or_none()

    if not reminder:
        raise HTTPException(status_code=404, detail="Medication reminder not found")

    if request.status:
        reminder.status = request.status

    if request.refill_due_date:
        reminder.refill_due_date = request.refill_due_date

    reminder.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(reminder)

    return MedicationReminderResponse.model_validate(reminder)
