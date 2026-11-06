"""Doctor schedules, free-slot calculation and booking, shared by every call the agent takes and by staff.

Doctor timings are static demo data for now (seeded once); slots are generated from each
doctor's working days, hours and slot length, minus already-booked appointments.
"""
import logging
from datetime import datetime, date, time, timedelta, timezone
from typing import Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.appointment import Appointment, ACTIVE_STATUSES, SOURCE_AGENT
from app.models.doctor import Doctor

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


def at_clinic_time(due_utc: datetime, call_time: Optional[str]) -> datetime:
    """Move a naive-UTC datetime to `call_time` ("HH:MM", clinic local) on the same clinic-local day."""
    if not call_time:
        return due_utc
    offset = timedelta(minutes=settings.clinic_utc_offset_minutes)
    local = datetime.combine((due_utc + offset).date(), _parse_hhmm(call_time))
    return local - offset


def followup_minutes(interval_minutes: Optional[int]) -> Optional[int]:
    """Minutes between check-ins when they run on minutes (plan setting, else the test override)."""
    if interval_minutes:
        return interval_minutes
    return settings.checkin_test_interval_minutes or None


def next_followup_due(
    start_utc: datetime, interval_days: int, call_time: Optional[str], interval_minutes: Optional[int] = None
) -> datetime:
    """Next check-in (naive UTC): interval_days after start_utc, at call_time if set.

    A minutes interval (or CHECKIN_TEST_INTERVAL_MINUTES) replaces the days and ignores call_time.
    """
    minutes = followup_minutes(interval_minutes)
    if minutes:
        return start_utc + timedelta(minutes=minutes)
    return at_clinic_time(start_utc + timedelta(days=interval_days), call_time)


def _parse_hhmm(value: str) -> time:
    hours, minutes = value.split(":")
    return time(int(hours), int(minutes))


async def seed_clinic_doctors(db: AsyncSession) -> None:
    """Insert the demo doctors once (no-op if any doctor exists)."""
    result = await db.execute(select(Doctor.id).limit(1))
    if result.scalar_one_or_none() is not None:
        return
    for data in DEMO_DOCTORS:
        db.add(Doctor(**data))
    await db.commit()
    logger.info("Seeded %d demo clinic doctors", len(DEMO_DOCTORS))


async def find_doctor_by_name(db: AsyncSession, name: Optional[str]) -> Optional[Doctor]:
    """Match a free-text physician name (e.g. a care plan's assigned physician) to a doctor."""
    if not name or not name.strip():
        return None
    wanted = name.strip().lower()
    for doctor in await get_active_doctors(db):
        if doctor.name.lower() == wanted:
            return doctor
    return None


async def get_active_doctors(db: AsyncSession) -> List[Doctor]:
    result = await db.execute(
        select(Doctor).where(Doctor.is_active == True).order_by(Doctor.id)
    )
    return list(result.scalars().all())


def day_slots(doctor: Doctor, day: date) -> List[datetime]:
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
        select(Appointment.doctor_id, Appointment.start_at).where(
            Appointment.doctor_id.in_(doctor_ids),
            Appointment.status.in_(ACTIVE_STATUSES),
            Appointment.start_at >= start,
            Appointment.start_at < end,
        )
    )
    booked: Dict[int, set] = {doctor_id: set() for doctor_id in doctor_ids}
    for doctor_id, start_at in result.all():
        booked[doctor_id].add(start_at)
    return booked


async def get_free_slots(
    db: AsyncSession,
    doctors: List[Doctor],
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
    call_log_id: Optional[int] = None,
    source: str = SOURCE_AGENT,
    patient_id: Optional[int] = None,
    plan_id: Optional[int] = None,
    status: str = "booked",
) -> Appointment:
    """Book a slot after validating it is a real, future, free slot for that doctor."""
    doctor = await db.get(Doctor, doctor_id)
    if not doctor or not doctor.is_active:
        raise BookingError("Doctor not found")

    start_at = start_at.replace(second=0, microsecond=0)
    if start_at not in day_slots(doctor, start_at.date()):
        raise BookingError("That time is not within the doctor's schedule")
    if start_at < clinic_now() + timedelta(minutes=MIN_LEAD_MINUTES):
        raise BookingError("That time has already passed")

    clash = await db.execute(
        select(Appointment.id).where(
            Appointment.doctor_id == doctor_id,
            Appointment.start_at == start_at,
            Appointment.status.in_(ACTIVE_STATUSES),
        )
    )
    if clash.scalar_one_or_none() is not None:
        raise BookingError("That slot is already booked")

    appointment = Appointment(
        doctor_id=doctor_id,
        call_log_id=call_log_id,
        patient_id=patient_id,
        plan_id=plan_id,
        patient_name=patient_name or "Unknown",
        phone_number=phone_number,
        reason=reason,
        start_at=start_at,
        end_at=start_at + timedelta(minutes=doctor.slot_minutes),
        status=status,
        source=source,
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
