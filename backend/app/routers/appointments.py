"""Appointment requests and bookings. Staff confirm, reschedule, cancel or complete them here.

Requests the agent records start "pending" (Pending confirmation). Staff call the patient,
agree the time, then confirm. Confirming or cancelling also closes the request's follow-up task.
"""
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import get_current_user
from app.config import get_settings
from app.database import get_db
from app.models.appointment import (
    SOURCE_STAFF,
    STATUS_CANCELLED,
    STATUS_CONFIRMED,
    STATUS_PENDING,
    STATUSES,
    Appointment,
)
from app.models.call_log import call_ref
from app.models.doctor import Doctor
from app.models.user import User
from app.routers.clinic import normalize_phone
from app.services.agent.context_shared import lookup_caller
from app.services.scheduling.callback_service import close_appointment_follow_ups
from app.services.scheduling.clinic_scheduling import BookingError, check_slot

settings = get_settings()
router = APIRouter(prefix="/api/appointments", tags=["appointments"])

STATUS_PATTERN = "^(" + "|".join(STATUSES) + ")$"


class AppointmentResponse(BaseModel):
    id: int
    doctor_id: Optional[int]
    doctor_name: str
    doctor_specialty: Optional[str]
    doctor_requested: Optional[str]
    patient_id: Optional[int]
    patient_name: str
    phone_number: Optional[str]
    call_log_id: Optional[int]
    call_ref: Optional[str]
    reason: Optional[str]
    preferred_time: Optional[str]
    start_at: Optional[datetime]
    end_at: Optional[datetime]
    status: str
    source: str
    staff_notes: Optional[str]
    confirmed_at: Optional[datetime]
    created_at: datetime


def _out(a: Appointment) -> AppointmentResponse:
    return AppointmentResponse(
        id=a.id,
        doctor_id=a.doctor_id,
        doctor_name=a.doctor_display_name,
        doctor_specialty=a.doctor.specialty if a.doctor else None,
        doctor_requested=a.doctor_requested,
        patient_id=a.patient_id,
        patient_name=a.patient_name,
        phone_number=a.phone_number,
        call_log_id=a.call_log_id,
        call_ref=call_ref(a.call_log_id) if a.call_log_id else None,
        reason=a.reason,
        preferred_time=a.preferred_time,
        start_at=a.start_at,
        end_at=a.end_at,
        status=a.status,
        source=a.source,
        staff_notes=a.staff_notes,
        confirmed_at=a.confirmed_at,
        created_at=a.created_at,
    )


async def _load(db: AsyncSession, appointment_id: int) -> Appointment:
    result = await db.execute(
        select(Appointment).options(selectinload(Appointment.doctor)).where(Appointment.id == appointment_id)
    )
    appointment = result.scalar_one_or_none()
    if not appointment:
        raise HTTPException(status_code=404, detail="Appointment not found")
    return appointment


@router.get("/", response_model=List[AppointmentResponse])
async def list_appointments(
    patient_id: Optional[int] = Query(None),
    doctor_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None, pattern=STATUS_PATTERN),
    source: Optional[str] = Query(None, pattern="^(agent|staff)$"),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=2000),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Appointments; pending requests first, then by time."""
    query = select(Appointment).options(selectinload(Appointment.doctor))
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
    query = query.order_by(Appointment.created_at.desc(), Appointment.id.desc())
    result = await db.execute(query.offset(skip).limit(limit))
    return [_out(a) for a in result.scalars().all()]


class StaffAppointmentCreate(BaseModel):
    patient_name: str = Field(min_length=1, max_length=120)
    phone_number: str = Field(min_length=6, max_length=20)
    doctor_id: int
    start_at: datetime
    reason: Optional[str] = Field(None, max_length=500)
    confirmed: bool = True


@router.post("/", response_model=AppointmentResponse, status_code=201)
async def create_appointment(
    data: StaffAppointmentCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    """Staff book an appointment into a doctor's free slot (e.g. for a walk-in or a phone call they took)."""
    doctor = await db.get(Doctor, data.doctor_id)
    if not doctor or not doctor.is_active:
        raise HTTPException(status_code=400, detail="Doctor not found")
    try:
        start_at = await check_slot(db, doctor, data.start_at.replace(tzinfo=None))
    except BookingError as err:
        raise HTTPException(status_code=400, detail=str(err))
    phone = normalize_phone(data.phone_number)
    patient = await lookup_caller(db, phone)
    appointment = Appointment(
        doctor_id=doctor.id,
        doctor_requested=doctor.specialty,
        patient_id=patient.id if patient else None,
        patient_name=data.patient_name.strip(),
        phone_number=phone,
        reason=data.reason,
        start_at=start_at,
        end_at=start_at + timedelta(minutes=doctor.slot_minutes),
        preferred_time=start_at.strftime("%a %d %b, %I:%M %p"),
        status=STATUS_CONFIRMED if data.confirmed else STATUS_PENDING,
        source=SOURCE_STAFF,
        confirmed_by_user_id=user.id if data.confirmed else None,
        confirmed_at=datetime.utcnow() if data.confirmed else None,
    )
    db.add(appointment)
    await db.commit()
    return _out(await _load(db, appointment.id))


@router.get("/{appointment_id}", response_model=AppointmentResponse)
async def get_appointment(appointment_id: int, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    return _out(await _load(db, appointment_id))


class AppointmentUpdate(BaseModel):
    status: Optional[str] = Field(None, pattern=STATUS_PATTERN)
    doctor_id: Optional[int] = None
    # Clinic time; set together with doctor_id (or the current doctor)
    start_at: Optional[datetime] = None
    staff_notes: Optional[str] = Field(None, max_length=2000)


@router.patch("/{appointment_id}", response_model=AppointmentResponse)
async def update_appointment(
    appointment_id: int,
    data: AppointmentUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Confirm (optionally setting doctor and time), reschedule, cancel or complete an appointment."""
    appointment = await _load(db, appointment_id)

    if data.doctor_id is not None or data.start_at is not None:
        doctor_id = data.doctor_id if data.doctor_id is not None else appointment.doctor_id
        doctor = await db.get(Doctor, doctor_id) if doctor_id else None
        if not doctor:
            raise HTTPException(status_code=400, detail="Choose a doctor")
        appointment.doctor_id = doctor.id
        start = data.start_at or appointment.start_at
        if start:
            try:
                start = await check_slot(db, doctor, start.replace(tzinfo=None), ignore_appointment_id=appointment.id)
            except BookingError as err:
                raise HTTPException(status_code=400, detail=str(err))
            appointment.start_at = start
            appointment.end_at = start + timedelta(minutes=doctor.slot_minutes)

    if data.staff_notes is not None:
        appointment.staff_notes = data.staff_notes

    if data.status and data.status != appointment.status:
        if data.status == STATUS_CONFIRMED:
            if not appointment.start_at or not appointment.doctor_id:
                raise HTTPException(status_code=400, detail="Set the doctor and time before confirming")
            appointment.confirmed_by_user_id = user.id
            appointment.confirmed_at = datetime.utcnow()
        appointment.status = data.status
        if data.status in (STATUS_CONFIRMED, STATUS_CANCELLED):
            await close_appointment_follow_ups(db, appointment.id, user.id)

    await db.commit()
    db.expire(appointment)
    return _out(await _load(db, appointment_id))
