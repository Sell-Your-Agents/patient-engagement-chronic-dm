"""One call record for every call to the clinic (a real phone call or a browser test call).

The columns under "Call record" are the structured record the clinic reviews after each call
(caller, contact, language, intent, doctor, preferred slot, outcome, booking status, next action).
They are filled from the transcript when the call ends (services/agent/call_finalizer.py).
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# Shown to staff as SS-1001, SS-1002, ...
CALL_REF_OFFSET = 1000

CHANNEL_PHONE = "phone"
CHANNEL_BROWSER = "browser"

INTENTS = (
    "appointment_booking",
    "doctor_enquiry",
    "clinic_info",
    "missed_call_callback",
    "human_assistance",
    "emergency",
    "other",
)
# confirmed: a connected clinic system confirmed it; pending: staff must confirm
BOOKING_STATUSES = ("confirmed", "pending", "not_applicable")


def call_ref(call_id: int) -> str:
    return f"SS-{CALL_REF_OFFSET + call_id}"


class CallLog(Base):
    __tablename__ = "call_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    # The caller's number (Twilio From), or the number typed in on the browser test page
    phone_number: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, index=True)
    patient_id: Mapped[Optional[int]] = mapped_column(ForeignKey("patients.id"), nullable=True, index=True)
    channel: Mapped[str] = mapped_column(String(20), default=CHANNEL_PHONE)
    call_sid: Mapped[Optional[str]] = mapped_column(String(50), unique=True, nullable=True)
    stream_sid: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    # in-progress | completed | transferred | failed
    status: Mapped[str] = mapped_column(String(20), default="in-progress", index=True)
    transcript: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    structured_summary: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    recording_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    duration_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    # ---- Call record ----
    patient_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    # en | hi | te: chosen during the call
    language: Mapped[Optional[str]] = mapped_column(String(5), nullable=True, index=True)
    intent: Mapped[Optional[str]] = mapped_column(String(30), nullable=True, index=True)
    doctor_requested: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    preferred_slot: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Short phrase, e.g. "Appointment request captured"
    outcome: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    booking_status: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    # e.g. "Clinic staff callback"
    next_action: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    # routine | soon | urgent | emergency
    urgency: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    patient: Mapped[Optional["Patient"]] = relationship("Patient")

    @property
    def call_ref(self) -> str:
        return call_ref(self.id)


class CallTurn(Base):
    __tablename__ = "call_turns"

    id: Mapped[int] = mapped_column(primary_key=True)
    call_log_id: Mapped[int] = mapped_column(ForeignKey("call_logs.id"), index=True)
    role: Mapped[str] = mapped_column(String(20))
    content: Mapped[str] = mapped_column(Text)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
