from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class EscalationCase(Base):
    __tablename__ = "escalation_cases"

    id: Mapped[int] = mapped_column(primary_key=True)
    outreach_call_id: Mapped[int] = mapped_column(ForeignKey("outreach_calls.id"))
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"))
    reason: Mapped[str] = mapped_column(Text)
    severity: Mapped[str] = mapped_column(String(20), default="medium")
    status: Mapped[str] = mapped_column(String(20), default="open")
    assigned_to_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("care_team_users.id"), nullable=True
    )
    resolution_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    acknowledged_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
