from datetime import datetime, date
from typing import Optional
from sqlalchemy import String, DateTime, Date, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class MedicationReminder(Base):
    __tablename__ = "medication_reminders"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"))
    care_plan_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("care_plans.id"), nullable=True
    )
    medication_name: Mapped[str] = mapped_column(String(120))
    last_refill_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    refill_due_date: Mapped[datetime] = mapped_column(DateTime, index=True)
    status: Mapped[str] = mapped_column(String(20), default="upcoming")
    reminder_sent_count: Mapped[int] = mapped_column(Integer, default=0)
    last_reminded_outreach_call_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("outreach_calls.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )
