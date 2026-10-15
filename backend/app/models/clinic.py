"""Models for the missed-call callback agent.

All clinic date/times (doctor hours, appointment slots, missed_at) are naive datetimes in
local clinic time (see settings.clinic_utc_offset_minutes). created_at columns stay in UTC
like the rest of the app.
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Text, ForeignKey, Integer, Boolean, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class ClinicDoctor(Base):
    __tablename__ = "clinic_doctors"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    specialty: Mapped[str] = mapped_column(String(80))
    # Short description of what the doctor treats; given to the agent for routing
    treats: Mapped[str] = mapped_column(Text, default="")
    # Weekdays the doctor works: 0=Monday ... 6=Sunday
    working_days: Mapped[list] = mapped_column(JSON, default=list)
    start_time: Mapped[str] = mapped_column(String(5))  # "HH:MM"
    end_time: Mapped[str] = mapped_column(String(5))  # "HH:MM"
    slot_minutes: Mapped[int] = mapped_column(Integer, default=15)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class MissedCall(Base):
    __tablename__ = "missed_calls"

    id: Mapped[int] = mapped_column(primary_key=True)
    phone_number: Mapped[str] = mapped_column(String(20), index=True)
    caller_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    missed_at: Mapped[datetime] = mapped_column(DateTime)  # clinic local time
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # pending | calling | booked | no_booking | no_answer | failed
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_attempt_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ClinicCall(Base):
    """One outbound callback attempt to a missed caller."""

    __tablename__ = "clinic_calls"

    id: Mapped[int] = mapped_column(primary_key=True)
    missed_call_id: Mapped[int] = mapped_column(ForeignKey("missed_calls.id"), index=True)
    phone_number: Mapped[str] = mapped_column(String(20))
    call_sid: Mapped[Optional[str]] = mapped_column(String(50), unique=True, nullable=True)
    # initiated | ringing | in-progress | completed | no-answer | busy | failed
    status: Mapped[str] = mapped_column(String(20), default="initiated")
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    duration_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    transcript: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Extracted after the call
    patient_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    urgency: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    outcome: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    structured_summary: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    missed_call: Mapped["MissedCall"] = relationship("MissedCall")


class ClinicCallTurn(Base):
    __tablename__ = "clinic_call_turns"

    id: Mapped[int] = mapped_column(primary_key=True)
    clinic_call_id: Mapped[int] = mapped_column(ForeignKey("clinic_calls.id"), index=True)
    role: Mapped[str] = mapped_column(String(20))
    content: Mapped[str] = mapped_column(Text)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ClinicAppointment(Base):
    __tablename__ = "clinic_appointments"

    id: Mapped[int] = mapped_column(primary_key=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("clinic_doctors.id"), index=True)
    missed_call_id: Mapped[Optional[int]] = mapped_column(ForeignKey("missed_calls.id"), nullable=True)
    clinic_call_id: Mapped[Optional[int]] = mapped_column(ForeignKey("clinic_calls.id"), nullable=True)
    patient_name: Mapped[str] = mapped_column(String(120))
    phone_number: Mapped[str] = mapped_column(String(20))
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    start_at: Mapped[datetime] = mapped_column(DateTime, index=True)  # clinic local time
    end_at: Mapped[datetime] = mapped_column(DateTime)
    # booked | cancelled | completed
    status: Mapped[str] = mapped_column(String(20), default="booked", index=True)
    booked_via: Mapped[str] = mapped_column(String(20), default="agent")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    doctor: Mapped["ClinicDoctor"] = relationship("ClinicDoctor")
