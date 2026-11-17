"""People who have called the clinic (or been added by staff).

A row is created or updated after a call once the caller has given their name, so staff can see
every call, appointment request and follow-up for one phone number in one place.
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

LANGUAGES = ("en", "hi", "te")


class Patient(Base):
    __tablename__ = "patients"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    phone_number: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    # en | hi | te (the language of their latest call)
    preferred_language: Mapped[str] = mapped_column(String(5), default="en")
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
