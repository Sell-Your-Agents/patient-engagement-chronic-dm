"""One appointments table.

source = "agent":  created by the phone agent. Booked into a real slot during the call (status
                   "booked"), or requested after a check-in call (status "requested", staff confirm).
source = "staff":  booked manually from the dashboard (status "booked").

Clinic datetimes (start_at / end_at) are naive and in local clinic time; created_at is UTC.
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base

SOURCE_AGENT = "agent"
SOURCE_STAFF = "staff"

# requested | booked | confirmed | cancelled | completed
# These statuses hold a doctor's slot (a request without a start_at holds nothing)
ACTIVE_STATUSES = ("requested", "booked", "confirmed")


class Appointment(Base):
    __tablename__ = "appointments"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Null when a health-coach request names a physician we have no schedule for
    doctor_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("doctors.id"), nullable=True, index=True
    )
    physician_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    patient_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("patients.id"), nullable=True, index=True
    )
    plan_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("plans.id"), nullable=True
    )
    call_log_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("call_logs.id"), nullable=True, index=True
    )
    patient_name: Mapped[str] = mapped_column(String(120))
    phone_number: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Null for a health-coach request that has no time yet
    start_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, index=True)
    end_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="booked", index=True)
    source: Mapped[str] = mapped_column(String(20), default=SOURCE_AGENT, index=True)
    confirmed_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    doctor: Mapped[Optional["Doctor"]] = relationship("Doctor")

    @property
    def doctor_display_name(self) -> str:
        return self.doctor.name if self.doctor else (self.physician_name or "Unassigned")
