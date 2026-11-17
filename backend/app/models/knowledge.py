"""Clinic knowledge base: the approved services, FAQs and policies the agent may share.

The agent answers clinic questions only from these entries, the doctor profiles and the clinic
details in settings. Anything not written here, it says it does not know and offers a callback.
"""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# service: something the clinic offers ("Blood tests", "ECG")
# faq:     a common question and its approved answer
# policy:  a rule callers should know (cancellations, what to bring, payment)
KNOWLEDGE_CATEGORIES = ("service", "faq", "policy")


class ClinicKnowledge(Base):
    __tablename__ = "clinic_knowledge"

    id: Mapped[int] = mapped_column(primary_key=True)
    category: Mapped[str] = mapped_column(String(20), default="faq", index=True)
    # The service name, or the question
    title: Mapped[str] = mapped_column(String(200))
    # Approved answer / details the agent may say
    content: Mapped[str] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
