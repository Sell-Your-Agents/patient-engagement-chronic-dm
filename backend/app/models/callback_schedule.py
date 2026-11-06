"""A call the clinic owes someone: a retry after a failed check-in, or a callback the caller asked for.

scheduled_time is naive local clinic time (like appointment start_at); created_at is UTC.
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Text, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base

SCHEDULE_TYPE_RETRY = "retry"
SCHEDULE_TYPE_REQUESTED = "requested"  # caller asked us to call them back
SCHEDULE_TYPE_STAFF = "staff"  # staff scheduled a follow-up from the call log
# Callbacks the dialer places (retries belong to the outreach scheduler)
DIALLED_SCHEDULE_TYPES = (SCHEDULE_TYPE_REQUESTED, SCHEDULE_TYPE_STAFF)

CALLBACK_PENDING = "pending"
CALLBACK_CALLING = "calling"  # the agent is dialling it now (see call_log_id)
CALLBACK_COMPLETED = "completed"
CALLBACK_CANCELLED = "cancelled"
CALLBACK_FAILED = "failed"  # nobody answered after max_attempts


class CallbackSchedule(Base):
    __tablename__ = "callback_schedules"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Null when an unknown caller asks for a callback
    patient_id: Mapped[Optional[int]] = mapped_column(ForeignKey("patients.id"), nullable=True)
    plan_id: Mapped[Optional[int]] = mapped_column(ForeignKey("plans.id"), nullable=True)
    phone_number: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    patient_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    scheduled_time: Mapped[datetime] = mapped_column(DateTime, index=True)
    schedule_type: Mapped[str] = mapped_column(String(50), default="routine")
    attempt_number: Mapped[int] = mapped_column(Integer, default=1)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    status: Mapped[str] = mapped_column(String(20), default=CALLBACK_PENDING, index=True)
    # The call during which this was scheduled
    source_outreach_call_log_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("call_logs.id"), nullable=True
    )
    # The latest call the agent placed for this callback
    call_log_id: Mapped[Optional[int]] = mapped_column(ForeignKey("call_logs.id"), nullable=True, index=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
