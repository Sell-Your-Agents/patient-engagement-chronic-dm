"""Follow-ups: the one list of people clinic staff must call back.

The agent never dials anyone. A follow-up is created when a caller:
  - describes an emergency or sounds in distress           (kind emergency / distress, priority urgent)
  - asks to speak to a person and is not connected live     (kind human_assistance, priority high)
  - asks something the agent cannot answer                  (kind unanswered_question)
  - asks to be called back, e.g. after a missed call        (kind callback)
  - makes an appointment request staff must confirm         (kind confirm_appointment)
Staff can also add one by hand (kind staff). Staff call the person, then mark it done.

follow_up_at is naive local clinic time; created_at is UTC.
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

KIND_EMERGENCY = "emergency"
KIND_DISTRESS = "distress"
KIND_HUMAN = "human_assistance"
KIND_UNANSWERED = "unanswered_question"
KIND_CALLBACK = "callback"
KIND_CONFIRM_APPOINTMENT = "confirm_appointment"
KIND_STAFF = "staff"
KINDS = (KIND_EMERGENCY, KIND_DISTRESS, KIND_HUMAN, KIND_UNANSWERED, KIND_CALLBACK, KIND_CONFIRM_APPOINTMENT, KIND_STAFF)

PRIORITY_URGENT = "urgent"
PRIORITY_HIGH = "high"
PRIORITY_NORMAL = "normal"
PRIORITIES = (PRIORITY_URGENT, PRIORITY_HIGH, PRIORITY_NORMAL)
DEFAULT_PRIORITY = {
    KIND_EMERGENCY: PRIORITY_URGENT,
    KIND_DISTRESS: PRIORITY_URGENT,
    KIND_HUMAN: PRIORITY_HIGH,
}

FOLLOWUP_PENDING = "pending"
FOLLOWUP_DONE = "done"
FOLLOWUP_CANCELLED = "cancelled"
FOLLOWUP_STATUSES = (FOLLOWUP_PENDING, FOLLOWUP_DONE, FOLLOWUP_CANCELLED)

# Live transfer to the front desk (human_assistance only)
TRANSFER_RINGING = "ringing"  # the front desk phone is ringing, the caller hears hold music
TRANSFER_ANSWERED = "answered"  # staff picked up and spoke to the caller (follow-up done)
TRANSFER_NOT_ANSWERED = "not_answered"  # nobody picked up; the caller heard the busy message


class FollowUp(Base):
    __tablename__ = "follow_ups"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(30), default=KIND_CALLBACK, index=True)
    # urgent | high | normal (urgent ones are shown first, in red)
    priority: Mapped[str] = mapped_column(String(10), default=PRIORITY_NORMAL, index=True)
    # The call it came from (null for tasks staff add by hand)
    call_log_id: Mapped[Optional[int]] = mapped_column(ForeignKey("call_logs.id"), nullable=True, index=True)
    appointment_id: Mapped[Optional[int]] = mapped_column(ForeignKey("appointments.id"), nullable=True, index=True)
    patient_id: Mapped[Optional[int]] = mapped_column(ForeignKey("patients.id"), nullable=True, index=True)
    patient_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    phone_number: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    doctor_requested: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    # When the caller would like to visit / be called, in their words
    preferred_time: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    # Why staff must call: the caller's question, problem or request
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # When staff should call (clinic time); null = as soon as possible
    follow_up_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default=FOLLOWUP_PENDING, index=True)
    # Live transfer result for "wants to talk to staff": ringing | answered | not_answered
    transfer_status: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    staff_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    completed_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
