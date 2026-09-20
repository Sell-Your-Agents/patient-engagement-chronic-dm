from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from datetime import datetime
from typing import List, Optional, Dict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user
from app.models.care_team_user import CareTeamUser
from app.models.appointment import Appointment
from app.services.appointment_service import AppointmentService

router = APIRouter(prefix="/api/appointments", tags=["appointments"])


class AppointmentResponse(BaseModel):
    id: int
    patient_id: int
    care_plan_id: Optional[int]
    physician_name: str
    scheduled_at: datetime
    duration_minutes: int
    status: str
    reason: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class AppointmentCreateRequest(BaseModel):
    patient_id: int
    care_plan_id: Optional[int] = None
    physician_name: str
    scheduled_at: datetime
    duration_minutes: int = 30
    reason: Optional[str] = None


class AppointmentUpdateRequest(BaseModel):
    status: Optional[str] = None
    scheduled_at: Optional[datetime] = None


@router.get("/", response_model=List[AppointmentResponse])
async def list_appointments(
    db: AsyncSession = Depends(get_db),
    _: CareTeamUser = Depends(get_current_user),
    patient_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
) -> List[AppointmentResponse]:
    """List appointments with optional filters."""
    query = select(Appointment)

    if patient_id:
        query = query.where(Appointment.patient_id == patient_id)

    if status:
        query = query.where(Appointment.status == status)

    query = query.offset(skip).limit(limit)
    result = await db.execute(query)
    appointments = result.scalars().all()

    return [AppointmentResponse.model_validate(apt) for apt in appointments]


@router.post("/", response_model=AppointmentResponse, status_code=201)
async def create_appointment(
    request: AppointmentCreateRequest,
    db: AsyncSession = Depends(get_db),
    _: CareTeamUser = Depends(get_current_user),
) -> AppointmentResponse:
    """Create a new appointment."""
    appointment = await AppointmentService.book_appointment(
        patient_id=request.patient_id,
        care_plan_id=request.care_plan_id,
        physician_name=request.physician_name,
        scheduled_at=request.scheduled_at,
        db=db,
    )
    appointment.reason = request.reason
    appointment.duration_minutes = request.duration_minutes
    await db.commit()
    await db.refresh(appointment)

    return AppointmentResponse.model_validate(appointment)


@router.get("/{id}", response_model=AppointmentResponse)
async def get_appointment(
    id: int,
    db: AsyncSession = Depends(get_db),
    _: CareTeamUser = Depends(get_current_user),
) -> AppointmentResponse:
    """Get appointment details."""
    result = await db.execute(
        select(Appointment).where(Appointment.id == id)
    )
    appointment = result.scalar_one_or_none()

    if not appointment:
        raise HTTPException(status_code=404, detail="Appointment not found")

    return AppointmentResponse.model_validate(appointment)


@router.patch("/{id}", response_model=AppointmentResponse)
async def update_appointment(
    id: int,
    request: AppointmentUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: CareTeamUser = Depends(get_current_user),
) -> AppointmentResponse:
    """Update an appointment."""
    result = await db.execute(
        select(Appointment).where(Appointment.id == id)
    )
    appointment = result.scalar_one_or_none()

    if not appointment:
        raise HTTPException(status_code=404, detail="Appointment not found")

    if request.status:
        appointment.status = request.status

    if request.scheduled_at:
        appointment.scheduled_at = request.scheduled_at

    appointment.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(appointment)

    return AppointmentResponse.model_validate(appointment)


@router.get("/availability/{physician_name}", response_model=List[Dict])
async def get_availability(
    physician_name: str,
    days_ahead: int = Query(14, ge=1, le=60),
    db: AsyncSession = Depends(get_db),
    _: CareTeamUser = Depends(get_current_user),
) -> List[Dict]:
    """Get available appointment slots for a physician."""
    availability = await AppointmentService.get_mock_availability(
        physician_name=physician_name,
        days_ahead=days_ahead,
    )
    return availability


@router.post("/{id}/confirm", response_model=AppointmentResponse)
async def confirm_appointment(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user: CareTeamUser = Depends(get_current_user),
) -> AppointmentResponse:
    """Confirm an appointment (care team action)."""
    appointment = await AppointmentService.confirm_appointment(
        appointment_id=id,
        confirmed_by_user_id=current_user.id,
        db=db,
    )
    await db.commit()
    await db.refresh(appointment)

    return AppointmentResponse.model_validate(appointment)


@router.post("/{id}/cancel", response_model=AppointmentResponse)
async def cancel_appointment(
    id: int,
    db: AsyncSession = Depends(get_db),
    _: CareTeamUser = Depends(get_current_user),
) -> AppointmentResponse:
    """Cancel an appointment."""
    appointment = await AppointmentService.cancel_appointment(
        appointment_id=id,
        db=db,
    )
    await db.commit()
    await db.refresh(appointment)

    return AppointmentResponse.model_validate(appointment)
