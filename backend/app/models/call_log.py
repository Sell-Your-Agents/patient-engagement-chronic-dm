"""One call log for every phone call. A single agent handles all of them; the context it is given
(see services/call_context.py) depends on the direction.

direction = "outbound": health-coaching check-in call to an enrolled patient
direction = "inbound":  someone called the clinic and the agent answered as receptionist

Columns that only make sense for one kind of call are nullable.
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Text, ForeignKey, Integer, Boolean, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base

DIRECTION_INBOUND = "inbound"
DIRECTION_OUTBOUND = "outbound"


class CallLog(Base):
    __tablename__ = "call_logs"

    id: Mapped[int] = mapped_column(primary_key=True)

    # ---- Common to every call ----
    direction: Mapped[str] = mapped_column(String(10), index=True)  # inbound | outbound
    # Outbound: the patient's number we dialled. Inbound: the caller's number (Twilio From).
    phone_number: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, index=True)
    # Always set for outbound; for inbound only when the caller's number matches a patient
    patient_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("patients.id"), nullable=True, index=True
    )
    channel: Mapped[str] = mapped_column(String(20), default="voice")
    call_sid: Mapped[Optional[str]] = mapped_column(String(50), unique=True, nullable=True)
    stream_sid: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    # initiated | in-progress | completed | failed | no-answer
    status: Mapped[str] = mapped_column(String(20), default="initiated")
    transcript: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    structured_summary: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    recording_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    duration_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # ---- Care-plan context: set on outbound check-ins, and on inbound calls from an enrolled patient ----
    plan_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("plans.id"), nullable=True
    )
    attempt_number: Mapped[int] = mapped_column(Integer, default=1)
    is_retry: Mapped[bool] = mapped_column(Boolean, default=False)
    warning_signs_detected: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    medication_adherence_reported: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )
    csat_score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # ---- Extracted from the transcript after the call ----
    patient_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    urgency: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    outcome: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)

    # Relationships
    patient: Mapped[Optional["Patient"]] = relationship("Patient")
    plan: Mapped[Optional["Plan"]] = relationship("Plan")


class CallTurn(Base):
    __tablename__ = "call_turns"

    id: Mapped[int] = mapped_column(primary_key=True)
    call_log_id: Mapped[int] = mapped_column(ForeignKey("call_logs.id"), index=True)
    role: Mapped[str] = mapped_column(String(20))
    content: Mapped[str] = mapped_column(Text)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
