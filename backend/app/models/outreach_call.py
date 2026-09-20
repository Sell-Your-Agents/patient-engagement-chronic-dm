from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Text, ForeignKey, Integer, Boolean, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class OutreachCall(Base):
    __tablename__ = "outreach_calls"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"))
    care_plan_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("care_plans.id"), nullable=True
    )
    channel: Mapped[str] = mapped_column(String(20), default="voice")
    call_sid: Mapped[Optional[str]] = mapped_column(String(50), unique=True, nullable=True)
    stream_sid: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    direction: Mapped[str] = mapped_column(String(20), default="outbound")
    status: Mapped[str] = mapped_column(String(20), default="initiated")
    attempt_number: Mapped[int] = mapped_column(Integer, default=1)
    is_retry: Mapped[bool] = mapped_column(Boolean, default=False)
    transcript: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    structured_summary: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    warning_signs_detected: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    medication_adherence_reported: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )
    csat_score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    recording_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    duration_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    patient: Mapped["Patient"] = relationship("Patient")
    care_plan: Mapped["CarePlan"] = relationship("CarePlan")


class ConversationTurn(Base):
    __tablename__ = "conversation_turns"

    id: Mapped[int] = mapped_column(primary_key=True)
    outreach_call_id: Mapped[int] = mapped_column(ForeignKey("outreach_calls.id"))
    role: Mapped[str] = mapped_column(String(20))
    content: Mapped[str] = mapped_column(Text)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
