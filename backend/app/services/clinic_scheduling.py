"""Doctor schedules, free-slot calculation and booking for the missed-call agent.

Doctor timings are static demo data for now (seeded once); slots are generated from each
doctor's working days, hours and slot length, minus already-booked appointments.
"""
import logging
from datetime import datetime, date, time, timedelta, timezone
from typing import Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.clinic import ClinicDoctor, ClinicAppointment

logger = logging.getLogger(__name__)
settings = get_settings()

# Don't offer slots that start sooner than this from "now"
MIN_LEAD_MINUTES = 30

WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

DEMO_DOCTORS = [
    {
        "name": "Dr. Ananya Rao",
        "specialty": "General Physician",
        "treats": "fever, cold, cough, infections, BP and sugar check-ups, diabetes, body pain, general health concerns",
        "working_days": [0, 1, 2, 3, 4, 5],
        "start_time": "09:00",
        "end_time": "13:00",
        "slot_minutes": 15,
    },
    {
        "name": "Dr. Rajesh Kumar",
        "specialty": "General Surgeon",
        "treats": "hernia, appendix, gallbladder stones, lumps, wounds, minor surgical procedures",
        "working_days": [0, 2, 4],
        "start_time": "10:00",
        "end_time": "13:00",
        "slot_minutes": 20,
    },
    {
        "name": "Dr. Priya Menon",
        "specialty": "Orthopedics",
        "treats": "bone, joint, knee, back and neck pain, fractures, sprains, sports injuries, arthritis",
        "working_days": [0, 1, 2, 3, 4],
        "start_time": "14:00",
        "end_time": "17:00",
        "slot_minutes": 20,
    },
    {
        "name": "Dr. Sameer Khan",
        "specialty": "Dentist",
        "treats": "toothache, cavities, gum problems, cleaning, root canal, braces, dental check-ups",
        "working_days": [0, 1, 2, 3, 4, 5],
        "start_time": "10:00",
        "end_time": "14:00",
        "slot_minutes": 15,
    },
    {
        "name": "Dr. Kavitha Reddy",
        "specialty": "Cardiologist",
        "treats": "chest pain, palpitations, heart problems, high blood pressure follow-up, breathlessness on exertion",
        "working_days": [1, 3, 5],
        "start_time": "09:00",
        "end_time": "12:00",
        "slot_minutes": 20,
    },
    {
        "name": "Dr. Arjun Iyer",
        "specialty": "Neurologist",
        "treats": "headaches, migraine, dizziness, seizures, numbness, nerve and brain related problems",
        "working_days": [0, 2, 4],
        "start_time": "15:00",
        "end_time": "18:00",
        "slot_minutes": 20,
    },
]


def clinic_now() -> datetime:
    """Current naive datetime in clinic local time."""
    tz = timezone(timedelta(minutes=settings.clinic_utc_offset_minutes))
    return datetime.now(tz).replace(tzinfo=None, second=0, microsecond=0)


def _parse_hhmm(value: str) -> time:
    hours, minutes = value.split(":")
    return time(int(hours), int(minutes))


async def seed_clinic_doctors(db: AsyncSession) -> None:
    """Insert the demo doctors once (no-op if any doctor exists)."""
    result = await db.execute(select(ClinicDoctor.id).limit(1))
    if result.scalar_one_or_none() is not None:
        return
    for data in DEMO_DOCTORS:
        db.add(ClinicDoctor(**data))
    await db.commit()
    logger.info("Seeded %d demo clinic doctors", len(DEMO_DOCTORS))


async def get_active_doctors(db: AsyncSession) -> List[ClinicDoctor]:
    result = await db.execute(
        select(ClinicDoctor).where(ClinicDoctor.is_active == True).order_by(ClinicDoctor.id)
    )
    return list(result.scalars().all())


def day_slots(doctor: ClinicDoctor, day: date) -> List[datetime]:
    """All slot start times for a doctor on a given day (ignores bookings)."""
    if day.weekday() not in (doctor.working_days or []):
        return []
    start = datetime.combine(day, _parse_hhmm(doctor.start_time))
    end = datetime.combine(day, _parse_hhmm(doctor.end_time))
    step = timedelta(minutes=doctor.slot_minutes)
    slots = []
    current = start
    while current + step <= end:
        slots.append(current)
        current += step
    return slots


async def _booked_starts(
    db: AsyncSession, doctor_ids: List[int], start: datetime, end: datetime
) -> Dict[int, set]:
    result = await db.execute(
        select(ClinicAppointment.doctor_id, ClinicAppointment.start_at).where(
            ClinicAppointment.doctor_id.in_(doctor_ids),
            ClinicAppointment.status == "booked",
            ClinicAppointment.start_at >= start,
            ClinicAppointment.start_at < end,
        )
    )
    booked: Dict[int, set] = {doctor_id: set() for doctor_id in doctor_ids}
    for doctor_id, start_at in result.all():
        booked[doctor_id].add(start_at)
    return booked


async def get_free_slots(
    db: AsyncSession,
    doctors: List[ClinicDoctor],
    days_ahead: Optional[int] = None,
) -> Dict[int, List[datetime]]:
    """Free slot start times per doctor id, from now until `days_ahead` days later."""
    days_ahead = days_ahead or settings.clinic_booking_days_ahead
    now = clinic_now()
    earliest = now + timedelta(minutes=MIN_LEAD_MINUTES)
    window_end = datetime.combine(now.date() + timedelta(days=days_ahead), time.min)

    booked = await _booked_starts(db, [d.id for d in doctors], now, window_end)
    free: Dict[int, List[datetime]] = {}
    for doctor in doctors:
        slots = []
        for offset in range(days_ahead):
            for slot in day_slots(doctor, now.date() + timedelta(days=offset)):
                if slot >= earliest and slot not in booked[doctor.id]:
                    slots.append(slot)
        free[doctor.id] = slots
    return free


class BookingError(Exception):
    pass


async def book_slot(
    db: AsyncSession,
    doctor_id: int,
    start_at: datetime,
    patient_name: str,
    phone_number: str,
    reason: Optional[str] = None,
    missed_call_id: Optional[int] = None,
    clinic_call_id: Optional[int] = None,
    booked_via: str = "agent",
) -> ClinicAppointment:
    """Book a slot after validating it is a real, future, free slot for that doctor."""
    doctor = await db.get(ClinicDoctor, doctor_id)
    if not doctor or not doctor.is_active:
        raise BookingError("Doctor not found")

    start_at = start_at.replace(second=0, microsecond=0)
    if start_at not in day_slots(doctor, start_at.date()):
        raise BookingError("That time is not within the doctor's schedule")
    if start_at < clinic_now() + timedelta(minutes=MIN_LEAD_MINUTES):
        raise BookingError("That time has already passed")

    clash = await db.execute(
        select(ClinicAppointment.id).where(
            ClinicAppointment.doctor_id == doctor_id,
            ClinicAppointment.start_at == start_at,
            ClinicAppointment.status == "booked",
        )
    )
    if clash.scalar_one_or_none() is not None:
        raise BookingError("That slot is already booked")

    appointment = ClinicAppointment(
        doctor_id=doctor_id,
        missed_call_id=missed_call_id,
        clinic_call_id=clinic_call_id,
        patient_name=patient_name or "Unknown",
        phone_number=phone_number,
        reason=reason,
        start_at=start_at,
        end_at=start_at + timedelta(minutes=doctor.slot_minutes),
        status="booked",
        booked_via=booked_via,
    )
    db.add(appointment)
    await db.flush()
    return appointment


def format_slot(slot: datetime) -> str:
    """Human-friendly time, e.g. '9:20 AM'."""
    return slot.strftime("%I:%M %p").lstrip("0")


def format_day(day: date, today: date) -> str:
    if day == today:
        label = "Today"
    elif day == today + timedelta(days=1):
        label = "Tomorrow"
    else:
        label = WEEKDAY_NAMES[day.weekday()]
    return f"{label} {day.strftime('%d %b %Y')} ({day.isoformat()})"
