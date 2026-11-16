"""Which notifications each staff member has read.

Notifications themselves are not stored: they are built live from escalations, callbacks and
appointments (routers/notifications.py), so they can never drift from the real records.
Only the read state is kept here, one row per user per notification key.
"""
from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class NotificationRead(Base):
    __tablename__ = "notification_reads"
    __table_args__ = (UniqueConstraint("user_id", "key", name="uq_notification_read_user_key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    #: e.g. "esc:12:raised", "cb:7:due", "appt:31:requested"
    key: Mapped[str] = mapped_column(String(64))
    read_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class NotificationClear(Base):
    """Notifications a staff member has cleared from their own list (they stay cleared)."""

    __tablename__ = "notification_clears"
    __table_args__ = (UniqueConstraint("user_id", "key", name="uq_notification_clear_user_key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    key: Mapped[str] = mapped_column(String(64))
    cleared_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
