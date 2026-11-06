from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from datetime import datetime, timedelta
from typing import List, Optional, Dict
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.auth.deps import get_current_user
from app.models.user import User
from app.models.appointment import Appointment
from app.services.scheduling.appointment_service import AppointmentService
from app.config import get_settings
from app.services.scheduling.clinic_scheduling import BookingError, book_slot
from app.routers.clinic import normalize_phone
from app.models.appointment import SOURCE_STAFF

settings = get_settings()
router = APIRouter(prefix="/api/appointments", tags=["appointments"])


class AppointmentResponse(BaseModel):
    id: int
    doctor_id: Optional[int]
    doctor_name: str
    doctor_specialty: Optional[str]
    patient_id: Optional[int]
    patient_name: str
    phone_number: Optional[str]
    plan_id: Optional[int]
    call_log_id: Optional[int]
    reason: Optional[str]
    # Null for a check-in request that has no time yet
    start_at: Optional[datetime]
    end_at: Optional[datetime]
    status: str
    source: str
    clinic_name: str
    created_at: datetime


def _out(a: Appointment) -> AppointmentResponse:
    return AppointmentResponse(
        id=a.id,
        doctor_id=a.doctor_id,
        doctor_name=a.doctor_display_name,
        doctor_specialty=a.doctor.specialty if a.doctor else None,
        patient_id=a.patient_id,
        patient_name=a.patient_name,
        phone_number=a.phone_number,
        plan_id=a.plan_id,
        call_log_id=a.call_log_id,
        reason=a.reason,
        start_at=a.start_at,
        end_at=a.end_at,
        status=a.status,
        source=a.source,
        clinic_name=settings.clinic_name,
        created_at=a.created_at,
    )


async def _load(db: AsyncSession, id: int) -> Optional[Appointment]:
    result = await db.execute(
        select(Appointment).options(selectinload(Appointment.doctor)).where(Appointment.id == id)
    )
    return result.scalar_one_or_none()


class AppointmentCreateRequest(BaseModel):
    patient_id: int
    plan_id: Optional[int] = None
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
    _: User = Depends(get_current_user),
    patient_id: Optional[int] = Query(None),
    doctor_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    source: Optional[str] = Query(None, pattern="^(agent|staff)$"),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
) -> List[AppointmentResponse]:
    """Every appointment (phone agent, check-in requests, staff), by time; requests with no time come first."""
    query = (
        select(Appointment)
        .options(selectinload(Appointment.doctor))
        .order_by(Appointment.start_at.asc().nulls_first(), Appointment.id)
    )
    if patient_id:
        query = query.where(Appointment.patient_id == patient_id)
    if doctor_id:
        query = query.where(Appointment.doctor_id == doctor_id)
    if status:
        query = query.where(Appointment.status == status)
    if source:
        query = query.where(Appointment.source == source)
    if date_from:
        query = query.where(Appointment.start_at >= date_from.replace(tzinfo=None))
    if date_to:
        query = query.where(Appointment.start_at < date_to.replace(tzinfo=None))
    result = await db.execute(query.offset(skip).limit(limit))
    return [_out(apt) for apt in result.scalars().all()]


class StaffBookingRequest(BaseModel):
    doctor_id: int
    start_at: datetime
    patient_name: str
    phone_number: str
    reason: Optional[str] = None


@router.post("/book", response_model=AppointmentResponse, status_code=201)
async def book_for_caller(
    data: StaffBookingRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Manual booking by staff into a doctor's free slot (same validation as the phone agent)."""
    try:
        appointment = await book_slot(
            db,
            doctor_id=data.doctor_id,
            start_at=data.start_at.replace(tzinfo=None),
            patient_name=data.patient_name.strip(),
            phone_number=normalize_phone(data.phone_number),
            reason=data.reason,
            source=SOURCE_STAFF,
        )
    except BookingError as err:
        raise HTTPException(status_code=400, detail=str(err))
    await db.commit()
    return _out(await _load(db, appointment.id))


@router.post("/", response_model=AppointmentResponse, status_code=201)
async def create_appointment(
    request: AppointmentCreateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> AppointmentResponse:
    """Create a new appointment."""
    try:
        appointment = await AppointmentService.book_appointment(
            patient_id=request.patient_id,
            plan_id=request.plan_id,
            physician_name=request.physician_name,
            scheduled_at=request.scheduled_at.replace(tzinfo=None),
            db=db,
        )
    except BookingError as err:
        raise HTTPException(status_code=400, detail=str(err))
    if request.reason:
        appointment.reason = request.reason
    await db.commit()
    return _out(await _load(db, appointment.id))


@router.get("/{id}", response_model=AppointmentResponse)
async def get_appointment(
    id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> AppointmentResponse:
    """Get appointment details."""
    appointment = await _load(db, id)

    if not appointment:
        raise HTTPException(status_code=404, detail="Appointment not found")

    return _out(appointment)


@router.patch("/{id}", response_model=AppointmentResponse)
async def update_appointment(
    id: int,
    request: AppointmentUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AppointmentResponse:
    """Update an appointment."""
    appointment = await _load(db, id)

    if not appointment:
        raise HTTPException(status_code=404, detail="Appointment not found")

    if request.status:
        appointment.status = request.status

    if request.scheduled_at:
        previous = appointment.start_at
        appointment.start_at = request.scheduled_at.replace(tzinfo=None)
        if appointment.end_at and previous:
            appointment.end_at = appointment.start_at + (appointment.end_at - previous)
        else:
            appointment.end_at = appointment.start_at + timedelta(minutes=30)

    appointment.updated_at = datetime.utcnow()
    await db.commit()

    return _out(await _load(db, id))


@router.get("/availability/{physician_name}", response_model=List[Dict])
async def get_availability(
    physician_name: str,
    days_ahead: int = Query(14, ge=1, le=60),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> List[Dict]:
    """Get available appointment slots for a physician."""
    availability = await AppointmentService.get_availability(
        db=db,
        physician_name=physician_name,
        days_ahead=days_ahead,
    )
    return availability


@router.post("/{id}/confirm", response_model=AppointmentResponse)
async def confirm_appointment(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AppointmentResponse:
    """Confirm an appointment (care team action)."""
    appointment = await AppointmentService.confirm_appointment(
        appointment_id=id,
        confirmed_by_user_id=current_user.id,
        db=db,
    )
    await db.commit()

    return _out(await _load(db, id))


@router.post("/{id}/cancel", response_model=AppointmentResponse)
async def cancel_appointment(
    id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> AppointmentResponse:
    """Cancel an appointment."""
    appointment = await AppointmentService.cancel_appointment(
        appointment_id=id,
        db=db,
    )
    await db.commit()

    return _out(await _load(db, id))
