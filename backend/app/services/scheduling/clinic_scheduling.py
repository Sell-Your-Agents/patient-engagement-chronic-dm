"""Doctor schedules and free slots (clinic time), shared by the agent's prompt and the dashboard.

Slots come from each doctor's consultation days, hours and slot length, minus appointments that
already hold that time (pending or confirmed).
"""
import logging
import re
from datetime import date, datetime, time, timedelta, timezone
from typing import Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.appointment import ACTIVE_STATUSES, Appointment
from app.models.doctor import Doctor

logger = logging.getLogger(__name__)
settings = get_settings()

# Don't offer slots that start sooner than this from "now"
MIN_LEAD_MINUTES = 30

WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
WEEKDAY_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


class BookingError(Exception):
    pass


def clinic_now() -> datetime:
    """Current naive datetime in clinic local time."""
    tz = timezone(timedelta(minutes=settings.clinic_utc_offset_minutes))
    return datetime.now(tz).replace(tzinfo=None, second=0, microsecond=0)


def parse_hhmm(value: str) -> time:
    hours, minutes = value.split(":")
    return time(int(hours), int(minutes))


async def get_active_doctors(db: AsyncSession) -> List[Doctor]:
    result = await db.execute(select(Doctor).where(Doctor.is_active == True).order_by(Doctor.id))  # noqa: E712
    return list(result.scalars().all())


def _name_key(name: str) -> str:
    """'Dr. Ramesh Agarwal' -> 'ramesh agarwal'."""
    return re.sub(r"^(dr|doctor)\.?\s+", "", name.strip().lower())


async def find_doctor(db: AsyncSession, wanted: Optional[str]) -> Optional[Doctor]:
    """Match what a caller asked for ("Dr. Agarwal", "Agarwal", "cardiologist") to one active doctor.

    Returns None when nothing matches or the match is ambiguous.
    """
    if not wanted or not wanted.strip():
        return None
    key = _name_key(wanted)
    doctors = await get_active_doctors(db)
    exact = [d for d in doctors if _name_key(d.name) == key]
    if len(exact) == 1:
        return exact[0]
    by_name = [d for d in doctors if key and key in _name_key(d.name)]
    if len(by_name) == 1:
        return by_name[0]
    by_specialty = [d for d in doctors if key and (key in d.specialty.lower() or d.specialty.lower() in key)]
    if len(by_specialty) == 1:
        return by_specialty[0]
    return None


def day_slots(doctor: Doctor, day: date) -> List[datetime]:
    """All slot start times for a doctor on a given day (ignores bookings)."""
    if day.weekday() not in (doctor.working_days or []):
        return []
    start = datetime.combine(day, parse_hhmm(doctor.start_time))
    end = datetime.combine(day, parse_hhmm(doctor.end_time))
    step = timedelta(minutes=doctor.slot_minutes or 15)
    slots = []
    current = start
    while current + step <= end:
        slots.append(current)
        current += step
    return slots


async def _held_starts(db: AsyncSession, doctor_ids: List[int], start: datetime, end: datetime) -> Dict[int, set]:
    held: Dict[int, set] = {doctor_id: set() for doctor_id in doctor_ids}
    if not doctor_ids:
        return held
    result = await db.execute(
        select(Appointment.doctor_id, Appointment.start_at).where(
            Appointment.doctor_id.in_(doctor_ids),
            Appointment.status.in_(ACTIVE_STATUSES),
            Appointment.start_at >= start,
            Appointment.start_at < end,
        )
    )
    for doctor_id, start_at in result.all():
        held[doctor_id].add(start_at)
    return held


async def get_free_slots(db: AsyncSession, doctors: List[Doctor], days_ahead: Optional[int] = None) -> Dict[int, List[datetime]]:
    """Free slot start times per doctor id, from now until `days_ahead` days later."""
    days_ahead = days_ahead or settings.clinic_booking_days_ahead
    now = clinic_now()
    earliest = now + timedelta(minutes=MIN_LEAD_MINUTES)
    window_end = datetime.combine(now.date() + timedelta(days=days_ahead), time.min)

    held = await _held_starts(db, [d.id for d in doctors], now, window_end)
    free: Dict[int, List[datetime]] = {}
    for doctor in doctors:
        slots = []
        for offset in range(days_ahead):
            for slot in day_slots(doctor, now.date() + timedelta(days=offset)):
                if slot >= earliest and slot not in held[doctor.id]:
                    slots.append(slot)
        free[doctor.id] = slots
    return free


async def check_slot(db: AsyncSession, doctor: Doctor, start_at: datetime, ignore_appointment_id: Optional[int] = None) -> datetime:
    """Raise BookingError unless start_at is a real, future, free slot of this doctor. Returns it normalised."""
    start_at = start_at.replace(second=0, microsecond=0)
    if start_at not in day_slots(doctor, start_at.date()):
        raise BookingError("That time is not within the doctor's consultation hours")
    if start_at < clinic_now() + timedelta(minutes=MIN_LEAD_MINUTES):
        raise BookingError("That time has already passed")
    query = select(Appointment.id).where(
        Appointment.doctor_id == doctor.id,
        Appointment.start_at == start_at,
        Appointment.status.in_(ACTIVE_STATUSES),
    )
    if ignore_appointment_id:
        query = query.where(Appointment.id != ignore_appointment_id)
    if (await db.execute(query.limit(1))).scalar_one_or_none() is not None:
        raise BookingError("That slot is already taken")
    return start_at


def schedule_text(doctor: Doctor) -> str:
    """'Monday to Saturday, 10:00 to 19:00' style summary of a doctor's consultation hours."""
    days = sorted(doctor.working_days or [])
    if not days:
        day_text = "no fixed days"
    elif len(days) > 2 and days == list(range(days[0], days[-1] + 1)):
        day_text = f"{WEEKDAY_FULL[days[0]]} to {WEEKDAY_FULL[days[-1]]}"
    else:
        day_text = ", ".join(WEEKDAY_FULL[d] for d in days)
    return f"{day_text}, {doctor.start_time} to {doctor.end_time}"


def format_day(day: date, today: date) -> str:
    if day == today:
        label = "Today"
    elif day == today + timedelta(days=1):
        label = "Tomorrow"
    else:
        label = WEEKDAY_NAMES[day.weekday()]
    return f"{label} {day.strftime('%d %b %Y')} ({day.isoformat()})"
