from datetime import datetime, date
from typing import Optional
from sqlalchemy import String, DateTime, Date, Text, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class ChronicCondition(Base):
    __tablename__ = "chronic_conditions"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(120))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class PatientCondition(Base):
    __tablename__ = "patient_conditions"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"))
    condition_id: Mapped[int] = mapped_column(ForeignKey("chronic_conditions.id"))
    diagnosed_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    severity: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(20), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    # Relationships
    chronic_condition: Mapped[ChronicCondition] = relationship("ChronicCondition")

    __table_args__ = (
        UniqueConstraint("patient_id", "condition_id", name="uq_patient_condition"),
    )
