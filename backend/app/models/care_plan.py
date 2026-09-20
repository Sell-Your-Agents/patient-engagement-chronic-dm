from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Text, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class CarePlan(Base):
    __tablename__ = "care_plans"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"))
    patient_condition_id: Mapped[int] = mapped_column(
        ForeignKey("patient_conditions.id")
    )
    protocol_id: Mapped[int] = mapped_column(ForeignKey("disease_protocols.id"))
    followup_interval_days: Mapped[int] = mapped_column(Integer)
    next_due_date: Mapped[datetime] = mapped_column(DateTime, index=True)
    last_outreach_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)
    assigned_physician_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    adjusted_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("care_team_users.id"), nullable=True
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    # Relationships
    patient_condition: Mapped["PatientCondition"] = relationship("PatientCondition")
    protocol: Mapped["DiseaseProtocol"] = relationship("DiseaseProtocol")
