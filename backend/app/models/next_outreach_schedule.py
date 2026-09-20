from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Text, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class NextOutreachSchedule(Base):
    __tablename__ = "next_outreach_schedules"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"))
    care_plan_id: Mapped[int] = mapped_column(ForeignKey("care_plans.id"))
    scheduled_time: Mapped[datetime] = mapped_column(DateTime, index=True)
    schedule_type: Mapped[str] = mapped_column(String(50), default="routine")
    attempt_number: Mapped[int] = mapped_column(Integer, default=1)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    source_outreach_call_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("outreach_calls.id"), nullable=True
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
