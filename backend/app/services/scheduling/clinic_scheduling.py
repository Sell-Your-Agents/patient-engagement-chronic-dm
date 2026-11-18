"""Doctor working hours (clinic time), shared by the agent's prompt, bookings and the dashboard.

There are no fixed appointment slots. Each doctor has working days and working hours, and a
patient comes any time within them. A visit is a day plus the patient's rough arrival time, and is
valid when that day is one of the doctor's working days and the time is within their hours.
"""
import logging
import re
from datetime import date, datetime, timedelta, timezone
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.doctor import Doctor

logger = logging.getLogger(__name__)
settings = get_settings()

WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
WEEKDAY_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


class BookingError(Exception):
    pass


def clinic_now() -> datetime:
    """Current naive datetime in clinic local time."""
    tz = timezone(timedelta(minutes=settings.clinic_utc_offset_minutes))
    return datetime.now(tz).replace(tzinfo=None, second=0, microsecond=0)


async def get_active_doctors(db: AsyncSession) -> List[Doctor]:
    result = await db.execute(select(Doctor).where(Doctor.is_active == True).order_by(Doctor.id))  # noqa: E712
    return list(result.scalars().all())


def _name_key(name: str) -> str:
    """'Dr. Ramesh Agarwal' -> 'ramesh agarwal'."""
    return re.sub(r"^(dr|doctor)\.?\s+", "", name.strip().lower())


async def find_doctor(db: AsyncSession, wanted: Optional[str]) -> Optional[Doctor]:
    """Match what a caller asked for ("Dr. Pratap", "Pratap", "dermatology") to one active doctor.

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


def _minutes(hhmm: str) -> int:
    hours, minutes = hhmm.split(":")
    return int(hours) * 60 + int(minutes)


def time_words(hhmm: str) -> str:
    """'09:00' -> '9 AM', '16:30' -> '4:30 PM'."""
    hours, minutes = (int(part) for part in hhmm.split(":"))
    suffix = "AM" if hours < 12 else "PM"
    hour12 = hours % 12 or 12
    return f"{hour12} {suffix}" if minutes == 0 else f"{hour12}:{minutes:02d} {suffix}"


def days_text(doctor: Doctor) -> str:
    """'Monday to Saturday' / 'Monday, Wednesday and Friday'."""
    days = sorted(doctor.working_days or [])
    if not days:
        return "no fixed days"
    if len(days) > 2 and days == list(range(days[0], days[-1] + 1)):
        return f"{WEEKDAY_FULL[days[0]]} to {WEEKDAY_FULL[days[-1]]}"
    names = [WEEKDAY_FULL[d] for d in days]
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def schedule_text(doctor: Doctor) -> str:
    """'Monday to Saturday, 10 AM to 2 PM'."""
    return f"{days_text(doctor)}, {time_words(doctor.start_time)} to {time_words(doctor.end_time)}"


def visit_text(when: datetime) -> str:
    """'Fri 21 Nov, around 2 PM' (how a visit is shown to staff and the agent)."""
    return f"{when.strftime('%a %d %b')}, {time_words(when.strftime('%H:%M'))}"


def visit_problem(doctor: Doctor, when: datetime) -> Optional[str]:
    """Why the doctor can't be visited then (None = fine): not a working day, outside hours, or past."""
    if when.weekday() not in (doctor.working_days or []):
        return f"{doctor.name} does not work on {WEEKDAY_FULL[when.weekday()]}s (works {schedule_text(doctor)})"
    minute = when.hour * 60 + when.minute
    if not _minutes(doctor.start_time) <= minute < _minutes(doctor.end_time):
        return f"that time is outside {doctor.name}'s working hours ({schedule_text(doctor)})"
    now = clinic_now()
    if when.date() < now.date():
        return "that day has already passed"
    if when.date() == now.date() and now.hour * 60 + now.minute >= _minutes(doctor.end_time):
        return f"{doctor.name}'s working hours for today are already over"
    return None


def check_visit(doctor: Doctor, when: datetime) -> datetime:
    """Raise BookingError unless the doctor works then. Returns the time without seconds."""
    when = when.replace(second=0, microsecond=0)
    problem = visit_problem(doctor, when)
    if problem:
        raise BookingError(problem[0].upper() + problem[1:])
    return when


def format_day(day: date, today: date) -> str:
    if day == today:
        label = "Today"
    elif day == today + timedelta(days=1):
        label = "Tomorrow"
    else:
        label = WEEKDAY_FULL[day.weekday()]
    return f"{label} {day.strftime('%d %b %Y')} ({day.isoformat()})"


def calendar_text(days: int = 14) -> str:
    """The next `days` dates with weekday names, so the agent turns "next Friday" into a real date."""
    today = clinic_now().date()
    return "\n".join(f"- {format_day(today + timedelta(days=offset), today)}" for offset in range(days))
