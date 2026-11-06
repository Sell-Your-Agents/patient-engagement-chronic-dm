"""REST API for the clinic dashboard: doctors, clinic stats and the shared appointment book."""
import logging
import re
from datetime import datetime, timedelta, time
from typing import List, Dict

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.auth.deps import get_current_user
from app.models.user import User
from app.models.appointment import Appointment
from app.models.call_log import CallLog, DIRECTION_INBOUND
from app.models.doctor import Doctor
from app.services.scheduling.clinic_scheduling import (
    clinic_now,
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
async def clinic_info(_: User = Depends(get_current_user)) -> Dict:
    return {
        "clinic_name": settings.clinic_name,
        "agent_name": settings.clinic_agent_name,
        "now": clinic_now().isoformat(),
    }


@router.get("/stats")
async def clinic_stats(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> Dict:
    now = clinic_now()
    day_start = datetime.combine(now.date(), time.min)
    day_end = day_start + timedelta(days=1)

    async def count(stmt) -> int:
        return (await db.execute(stmt)).scalar() or 0

    inbound = CallLog.direction == DIRECTION_INBOUND
    # Appointments on the shared book that hold a real time slot (any source)
    scheduled = Appointment.start_at.is_not(None)
    total_calls = await count(select(func.count(CallLog.id)).where(inbound))
    completed = await count(select(func.count(CallLog.id)).where(inbound, CallLog.status == "completed"))
    calls_booked = await count(select(func.count(CallLog.id)).where(inbound, CallLog.outcome == "booked"))
    known_patients = await count(select(func.count(CallLog.id)).where(inbound, CallLog.patient_id.is_not(None)))
    booked = await count(select(func.count(Appointment.id)).where(scheduled, Appointment.status != "cancelled"))
    today = await count(
        select(func.count(Appointment.id)).where(
            Appointment.status.in_(("booked", "confirmed")),
            Appointment.start_at >= day_start,
            Appointment.start_at < day_end,
        )
    )
    upcoming = await count(
        select(func.count(Appointment.id)).where(
            Appointment.status.in_(("booked", "confirmed")), Appointment.start_at >= now
        )
    )
    return {
        "total_calls": total_calls,
        "calls_completed": completed,
        "calls_booked": calls_booked,
        "known_patient_calls": known_patients,
        "appointments_booked": booked,
        "appointments_today": today,
        "upcoming_appointments": upcoming,
        "conversion_rate": round(calls_booked / completed * 100, 1) if completed else 0,
    }


# ---------- Doctors ----------

@router.get("/doctors", response_model=List[DoctorResponse])
async def list_doctors(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Doctor).order_by(Doctor.id))
    return result.scalars().all()


@router.get("/doctors/{doctor_id}/availability")
async def doctor_availability(
    doctor_id: int,
    days: int = Query(7, ge=1, le=30),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> List[str]:
    doctor = await db.get(Doctor, doctor_id)
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")
    free = await get_free_slots(db, [doctor], days)
    return [slot.isoformat() for slot in free[doctor.id]]
