"""Doctors are shared by both agents: Maya books into their slots, and the Health Coach
requests appointments with them."""
from datetime import datetime
from sqlalchemy import String, DateTime, Text, Integer, Boolean, JSON
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class Doctor(Base):
    __tablename__ = "doctors"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    specialty: Mapped[str] = mapped_column(String(80))
    # Short description of what the doctor treats; given to the agent for routing
    treats: Mapped[str] = mapped_column(Text, default="")
    # Weekdays the doctor works: 0=Monday ... 6=Sunday
    working_days: Mapped[list] = mapped_column(JSON, default=list)
    start_time: Mapped[str] = mapped_column(String(5))  # "HH:MM"
    end_time: Mapped[str] = mapped_column(String(5))  # "HH:MM"
    slot_minutes: Mapped[int] = mapped_column(Integer, default=15)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
