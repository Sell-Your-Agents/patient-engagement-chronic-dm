"""Doctor profiles and consultation schedules (clinic-specific configuration).

The agent only tells callers what is written here: specialty, consultation days and timings, and
the fee when one is filled in. Staff edit these on the Doctors page.
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Doctor(Base):
    __tablename__ = "doctors"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    specialty: Mapped[str] = mapped_column(String(80))
    qualification: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    # What the doctor treats; helps the agent route "which doctor should I see?"
    treats: Mapped[str] = mapped_column(Text, default="")
    # Weekdays the doctor consults: 0=Monday ... 6=Sunday
    working_days: Mapped[list] = mapped_column(JSON, default=list)
    start_time: Mapped[str] = mapped_column(String(5))  # "HH:MM" clinic time
    end_time: Mapped[str] = mapped_column(String(5))  # "HH:MM" clinic time
    slot_minutes: Mapped[int] = mapped_column(Integer, default=15)
    # Consultation fee as the clinic wants it said (empty = the agent says it is not listed)
    consultation_fee: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    # Languages the doctor speaks, free text (e.g. "English, Hindi, Telugu")
    languages: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
