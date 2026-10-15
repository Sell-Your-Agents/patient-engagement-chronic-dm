"""REST API for the missed-call callback agent."""
import logging
import re
from datetime import datetime, timedelta, time
from typing import List, Optional, Dict

import twilio.rest
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.deps import get_current_user
from app.models.care_team_user import CareTeamUser
from app.models.clinic import ClinicDoctor, MissedCall, ClinicCall, ClinicAppointment
from app.services.clinic_scheduling import (
    BookingError,
    book_slot,
    clinic_now,
    get_active_doctors,
    get_free_slots,
)

logger = logging.getLogger(__name__)
settings = get_settings()
router = APIRouter(prefix="/api/clinic", tags=["clinic"])


# ---------- Schemas ----------

class DoctorResponse(BaseModel):
    id: int
    name: str
    specialty: str
    treats: str
    working_days: List[int]
    start_time: str
    end_time: str
    slot_minutes: int
    is_active: bool

    class Config:
        from_attributes = True


class MissedCallCreate(BaseModel):
    phone_number: str
    caller_name: Optional[str] = None
    missed_at: Optional[datetime] = None
    notes: Optional[str] = None


class MissedCallResponse(BaseModel):
    id: int
    phone_number: str
    caller_name: Optional[str]
    missed_at: datetime
    notes: Optional[str]
    status: str
    attempts: int
    last_attempt_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


class ClinicCallResponse(BaseModel):
    id: int
    missed_call_id: int
    phone_number: str
    call_sid: Optional[str]
    status: str
    started_at: Optional[datetime]
    ended_at: Optional[datetime]
    duration_seconds: Optional[int]
    transcript: Optional[str]
    patient_name: Optional[str]
    reason: Optional[str]
    urgency: Optional[str]
    outcome: Optional[str]
    summary: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class AppointmentResponse(BaseModel):
    id: int
    doctor_id: int
    doctor_name: str
    doctor_specialty: str
    missed_call_id: Optional[int]
    clinic_call_id: Optional[int]
    patient_name: str
    phone_number: str
    reason: Optional[str]
    start_at: datetime
    end_at: datetime
    status: str
    booked_via: str
    clinic_name: str
    created_at: datetime


class AppointmentCreate(BaseModel):
    doctor_id: int
    start_at: datetime
    patient_name: str
    phone_number: str
    reason: Optional[str] = None


class AppointmentUpdate(BaseModel):
    status: str  # cancelled | completed


def _appointment_out(a: ClinicAppointment) -> AppointmentResponse:
    return AppointmentResponse(
        id=a.id,
        doctor_id=a.doctor_id,
        doctor_name=a.doctor.name,
        doctor_specialty=a.doctor.specialty,
        missed_call_id=a.missed_call_id,
        clinic_call_id=a.clinic_call_id,
        patient_name=a.patient_name,
        phone_number=a.phone_number,
        reason=a.reason,
        start_at=a.start_at,
        end_at=a.end_at,
        status=a.status,
        booked_via=a.booked_via,
        clinic_name=settings.clinic_name,
        created_at=a.created_at,
    )


# A callback Twilio never reported back on (e.g. the ngrok tunnel was down) would otherwise stay
# "calling" forever and block "Call Again". Calls still initiated/ringing after this are failed.
STALE_CALL_MINUTES = 3


async def expire_stale_callbacks(db: AsyncSession) -> None:
    cutoff = datetime.utcnow() - timedelta(minutes=STALE_CALL_MINUTES)
    result = await db.execute(
        select(ClinicCall).where(
            ClinicCall.status.in_(["initiated", "ringing"]),
            ClinicCall.created_at < cutoff,
        )
    )
    stale = list(result.scalars().all())
    for call in stale:
        call.status = "failed"
        call.ended_at = call.ended_at or datetime.utcnow()
        missed_call = await db.get(MissedCall, call.missed_call_id)
        if missed_call and missed_call.status == "calling":
            missed_call.status = "failed"
    if stale:
        await db.commit()
        logger.info("Expired %d stale clinic callbacks", len(stale))


def normalize_phone(raw: str) -> str:
    """Return an E.164 number; bare 10-digit numbers are treated as Indian (+91)."""
    digits = re.sub(r"[^\d+]", "", raw.strip())
    if digits.startswith("+"):
        number = "+" + re.sub(r"\D", "", digits)
    elif len(digits) == 10:
        number = "+91" + digits
    elif len(digits) == 12 and digits.startswith("91"):
        number = "+" + digits
    else:
        number = "+" + digits
    if not re.fullmatch(r"\+\d{8,15}", number):
        raise HTTPException(status_code=400, detail="Enter a valid phone number, e.g. +919876543210")
    return number


# ---------- Clinic info & stats ----------

@router.get("/info")
async def clinic_info(_: CareTeamUser = Depends(get_current_user)) -> Dict:
    return {
        "clinic_name": settings.clinic_name,
        "agent_name": settings.clinic_agent_name,
        "now": clinic_now().isoformat(),
    }


@router.get("/stats")
async def clinic_stats(
    db: AsyncSession = Depends(get_db),
    _: CareTeamUser = Depends(get_current_user),
) -> Dict:
    await expire_stale_callbacks(db)
    now = clinic_now()
    day_start = datetime.combine(now.date(), time.min)
    day_end = day_start + timedelta(days=1)

    async def count(stmt) -> int:
        return (await db.execute(stmt)).scalar() or 0

    total_missed = await count(select(func.count(MissedCall.id)))
    pending = await count(select(func.count(MissedCall.id)).where(MissedCall.status == "pending"))
    calls_made = await count(select(func.count(ClinicCall.id)))
    connected = await count(select(func.count(ClinicCall.id)).where(ClinicCall.status == "completed"))
    booked = await count(select(func.count(ClinicAppointment.id)).where(ClinicAppointment.status != "cancelled"))
    today = await count(
        select(func.count(ClinicAppointment.id)).where(
            ClinicAppointment.status == "booked",
            ClinicAppointment.start_at >= day_start,
            ClinicAppointment.start_at < day_end,
        )
    )
    upcoming = await count(
        select(func.count(ClinicAppointment.id)).where(
            ClinicAppointment.status == "booked", ClinicAppointment.start_at >= now
        )
    )
    converted = await count(select(func.count(MissedCall.id)).where(MissedCall.status == "booked"))
    contacted = await count(
        select(func.count(MissedCall.id)).where(MissedCall.status.in_(["booked", "no_booking"]))
    )
    return {
        "total_missed_calls": total_missed,
        "pending_callbacks": pending,
        "callbacks_made": calls_made,
        "callbacks_connected": connected,
        "appointments_booked": booked,
        "appointments_today": today,
        "upcoming_appointments": upcoming,
        "conversion_rate": round(converted / contacted * 100, 1) if contacted else 0,
    }


# ---------- Doctors ----------

@router.get("/doctors", response_model=List[DoctorResponse])
async def list_doctors(
    db: AsyncSession = Depends(get_db),
    _: CareTeamUser = Depends(get_current_user),
):
    result = await db.execute(select(ClinicDoctor).order_by(ClinicDoctor.id))
    return result.scalars().all()


@router.get("/doctors/{doctor_id}/availability")
async def doctor_availability(
    doctor_id: int,
    days: int = Query(7, ge=1, le=30),
    db: AsyncSession = Depends(get_db),
    _: CareTeamUser = Depends(get_current_user),
) -> List[str]:
    doctor = await db.get(ClinicDoctor, doctor_id)
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")
    free = await get_free_slots(db, [doctor], days)
    return [slot.isoformat() for slot in free[doctor.id]]


# ---------- Missed calls ----------

@router.get("/missed-calls", response_model=List[MissedCallResponse])
async def list_missed_calls(
    status: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: CareTeamUser = Depends(get_current_user),
):
    await expire_stale_callbacks(db)
    query = select(MissedCall).order_by(MissedCall.missed_at.desc()).limit(500)
    if status:
        query = query.where(MissedCall.status == status)
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/missed-calls", response_model=MissedCallResponse, status_code=201)
async def create_missed_call(
    data: MissedCallCreate,
    db: AsyncSession = Depends(get_db),
    _: CareTeamUser = Depends(get_current_user),
):
    missed_call = MissedCall(
        phone_number=normalize_phone(data.phone_number),
        caller_name=(data.caller_name or "").strip() or None,
        missed_at=(data.missed_at or clinic_now()).replace(tzinfo=None),
        notes=(data.notes or "").strip() or None,
        status="pending",
    )
    db.add(missed_call)
    await db.commit()
    await db.refresh(missed_call)
    return missed_call


@router.delete("/missed-calls/{missed_call_id}", status_code=204)
async def delete_missed_call(
    missed_call_id: int,
    db: AsyncSession = Depends(get_db),
    _: CareTeamUser = Depends(get_current_user),
):
    missed_call = await db.get(MissedCall, missed_call_id)
    if not missed_call:
        raise HTTPException(status_code=404, detail="Missed call not found")
    has_calls = await db.execute(
        select(ClinicCall.id).where(ClinicCall.missed_call_id == missed_call_id).limit(1)
    )
    if has_calls.scalar_one_or_none() is not None:
        raise HTTPException(status_code=400, detail="This missed call already has callback history")
    await db.delete(missed_call)
    await db.commit()


@router.post("/missed-calls/{missed_call_id}/callback", response_model=ClinicCallResponse)
async def start_callback(
    missed_call_id: int,
    db: AsyncSession = Depends(get_db),
    _: CareTeamUser = Depends(get_current_user),
):
    """Have the AI agent call the missed caller back."""
    await expire_stale_callbacks(db)
    missed_call = await db.get(MissedCall, missed_call_id)
    if not missed_call:
        raise HTTPException(status_code=404, detail="Missed call not found")
    if missed_call.status == "calling":
        raise HTTPException(status_code=400, detail="A callback is already in progress for this number")
    if not (settings.twilio_account_sid and settings.twilio_auth_token and settings.twilio_phone_number):
        raise HTTPException(status_code=400, detail="Twilio is not configured in backend/.env")
    if settings.api_base_url.startswith("http://localhost"):
        raise HTTPException(
            status_code=400,
            detail="API_BASE_URL must be your public ngrok https URL so Twilio can reach the backend",
        )

    clinic_call = ClinicCall(
        missed_call_id=missed_call.id,
        phone_number=missed_call.phone_number,
        status="initiated",
    )
    db.add(clinic_call)
    missed_call.attempts += 1
    missed_call.last_attempt_at = datetime.utcnow()
    await db.flush()

    try:
        client = twilio.rest.Client(settings.twilio_account_sid, settings.twilio_auth_token)
        call = client.calls.create(
            from_=settings.twilio_phone_number,
            to=missed_call.phone_number,
            url=f"{settings.api_base_url}/twilio/clinic/twiml",
            method="POST",
            status_callback=f"{settings.api_base_url}/twilio/clinic/status",
            status_callback_method="POST",
            status_callback_event=["ringing", "answered", "completed"],
            timeout=30,
        )
    except Exception as exc:
        logger.error(f"Clinic callback failed to start: {exc}")
        clinic_call.status = "failed"
        missed_call.status = "failed"
        await db.commit()
        raise HTTPException(status_code=500, detail=f"Failed to start call: {exc}")

    clinic_call.call_sid = call.sid
    missed_call.status = "calling"
    await db.commit()
    await db.refresh(clinic_call)
    return clinic_call


# ---------- Callback calls ----------

@router.get("/calls", response_model=List[ClinicCallResponse])
async def list_clinic_calls(
    db: AsyncSession = Depends(get_db),
    _: CareTeamUser = Depends(get_current_user),
):
    await expire_stale_callbacks(db)
    result = await db.execute(select(ClinicCall).order_by(ClinicCall.created_at.desc()).limit(500))
    return result.scalars().all()


@router.get("/calls/{call_id}", response_model=ClinicCallResponse)
async def get_clinic_call(
    call_id: int,
    db: AsyncSession = Depends(get_db),
    _: CareTeamUser = Depends(get_current_user),
):
    call = await db.get(ClinicCall, call_id)
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    return call


# ---------- Appointments ----------

@router.get("/appointments", response_model=List[AppointmentResponse])
async def list_appointments(
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    doctor_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: CareTeamUser = Depends(get_current_user),
):
    from sqlalchemy.orm import selectinload

    query = (
        select(ClinicAppointment)
        .options(selectinload(ClinicAppointment.doctor))
        .order_by(ClinicAppointment.start_at)
        .limit(1000)
    )
    if date_from:
        query = query.where(ClinicAppointment.start_at >= date_from.replace(tzinfo=None))
    if date_to:
        query = query.where(ClinicAppointment.start_at < date_to.replace(tzinfo=None))
    if doctor_id:
        query = query.where(ClinicAppointment.doctor_id == doctor_id)
    if status:
        query = query.where(ClinicAppointment.status == status)
    result = await db.execute(query)
    return [_appointment_out(a) for a in result.scalars().all()]


@router.post("/appointments", response_model=AppointmentResponse, status_code=201)
async def create_appointment(
    data: AppointmentCreate,
    db: AsyncSession = Depends(get_db),
    _: CareTeamUser = Depends(get_current_user),
):
    """Manual booking by staff (same validation as the agent)."""
    try:
        appointment = await book_slot(
            db,
            doctor_id=data.doctor_id,
            start_at=data.start_at.replace(tzinfo=None),
            patient_name=data.patient_name.strip(),
            phone_number=normalize_phone(data.phone_number),
            reason=data.reason,
            booked_via="staff",
        )
    except BookingError as err:
        raise HTTPException(status_code=400, detail=str(err))
    await db.commit()
    await db.refresh(appointment, ["doctor"])
    return _appointment_out(appointment)


@router.patch("/appointments/{appointment_id}", response_model=AppointmentResponse)
async def update_appointment(
    appointment_id: int,
    data: AppointmentUpdate,
    db: AsyncSession = Depends(get_db),
    _: CareTeamUser = Depends(get_current_user),
):
    if data.status not in ("cancelled", "completed"):
        raise HTTPException(status_code=400, detail="Invalid status")
    appointment = await db.get(ClinicAppointment, appointment_id)
    if not appointment:
        raise HTTPException(status_code=404, detail="Appointment not found")
    if appointment.status != "booked":
        raise HTTPException(status_code=400, detail=f"Appointment is already {appointment.status}")
    appointment.status = data.status
    await db.commit()
    await db.refresh(appointment, ["doctor"])
    return _appointment_out(appointment)
