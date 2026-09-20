from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Text, Boolean, ForeignKey, Integer, JSON
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class DiseaseProtocol(Base):
    __tablename__ = "disease_protocols"

    id: Mapped[int] = mapped_column(primary_key=True)
    condition_id: Mapped[int] = mapped_column(ForeignKey("chronic_conditions.id"))
    version: Mapped[int] = mapped_column(Integer, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    assessment_questions: Mapped[list] = mapped_column(JSON)
    red_flag_criteria: Mapped[list] = mapped_column(JSON)
    education_talking_points: Mapped[list] = mapped_column(JSON)
    medication_classes: Mapped[list] = mapped_column(JSON, default=list)
    lab_reminder_defaults: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    escalation_instructions: Mapped[str] = mapped_column(Text)
    default_followup_interval_days: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )
