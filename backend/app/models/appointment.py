"""Appointment requests and bookings.

The agent never confirms an appointment by itself. A request it records starts "pending"
(Pending confirmation); clinic staff confirm or cancel it from the dashboard. When a clinic
appointment system is connected (services/scheduling/appointment_service.py) and it reports a
successful booking, the request is stored "confirmed" straight away.

Clinic datetimes (start_at / end_at) are naive and in local clinic time; created_at is UTC.
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

SOURCE_AGENT = "agent"
SOURCE_STAFF = "staff"

STATUS_PENDING = "pending"  # Pending confirmation
STATUS_CONFIRMED = "confirmed"
STATUS_CANCELLED = "cancelled"
STATUS_COMPLETED = "completed"
STATUSES = (STATUS_PENDING, STATUS_CONFIRMED, STATUS_CANCELLED, STATUS_COMPLETED)
# These statuses hold a doctor's slot (a request without a start_at holds nothing)
ACTIVE_STATUSES = (STATUS_PENDING, STATUS_CONFIRMED)


class Appointment(Base):
    __tablename__ = "appointments"

    id: Mapped[int] = mapped_column(primary_key=True)
    call_log_id: Mapped[Optional[int]] = mapped_column(ForeignKey("call_logs.id"), nullable=True, index=True)
    patient_id: Mapped[Optional[int]] = mapped_column(ForeignKey("patients.id"), nullable=True, index=True)
    # Null when the caller only named a specialty, or a doctor we have no profile for
    doctor_id: Mapped[Optional[int]] = mapped_column(ForeignKey("doctors.id"), nullable=True, index=True)
    # The doctor or specialty as the caller asked for it ("General Physician", "Dr. Agarwal")
    doctor_requested: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    patient_name: Mapped[str] = mapped_column(String(120))
    phone_number: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # The caller's preferred time in words ("Tomorrow around 5 PM", "Tomorrow evening")
    preferred_time: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    # A concrete slot, when one was requested or set by staff
    start_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, index=True)
    end_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default=STATUS_PENDING, index=True)
    source: Mapped[str] = mapped_column(String(20), default=SOURCE_AGENT, index=True)
    # Reference returned by a connected clinic appointment system, if any
    external_ref: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    staff_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    confirmed_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    confirmed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Loaded together with the appointment ("selectin"): async code must never lazy-load it
    doctor: Mapped[Optional["Doctor"]] = relationship("Doctor", lazy="selectin")

    @property
    def doctor_display_name(self) -> str:
        return self.doctor.name if self.doctor else (self.doctor_requested or "Not chosen")
