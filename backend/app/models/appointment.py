from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Text, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class Appointment(Base):
    __tablename__ = "appointments"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"))
    care_plan_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("care_plans.id"), nullable=True
    )
    triggering_outreach_call_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("outreach_calls.id"), nullable=True
    )
    physician_name: Mapped[str] = mapped_column(String(120))
    scheduled_at: Mapped[datetime] = mapped_column(DateTime)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=30)
    status: Mapped[str] = mapped_column(String(20), default="requested")
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    confirmed_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("care_team_users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )
