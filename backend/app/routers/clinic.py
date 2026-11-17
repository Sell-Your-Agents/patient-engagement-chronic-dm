"""Clinic-specific configuration: clinic details, doctor profiles and schedules, and the knowledge base."""
import logging
import re
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.config import get_settings
from app.database import get_db
from app.models.doctor import Doctor
from app.models.knowledge import KNOWLEDGE_CATEGORIES, ClinicKnowledge
from app.models.user import User
from app.services.agent.context_shared import LANGUAGE_NAMES, offered_languages
from app.services.scheduling.clinic_scheduling import clinic_now, get_free_slots
from app.services.voice.telephony import twilio_configured

logger = logging.getLogger(__name__)
settings = get_settings()
router = APIRouter(prefix="/api/clinic", tags=["clinic"])

HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def normalize_phone(raw: str) -> str:
    """Return an E.164 number; bare 10-digit numbers are treated as Indian (+91)."""
    digits = re.sub(r"[^\d+]", "", raw.strip())
    if digits.startswith("+"):
        number = "+" + re.sub(r"\D", "", digits)
    elif len(digits) == 10:
        number = "+91" + digits
    elif len(digits) == 12 and digits.startswith("91"):
        number = "+" + digits
    else:
        number = "+" + digits
    if not re.fullmatch(r"\+\d{8,15}", number):
        raise HTTPException(status_code=400, detail="Enter a valid phone number, e.g. +919876543210")
    return number


# ---------- Clinic info ----------

@router.get("/info")
async def clinic_info(_: User = Depends(get_current_user)) -> Dict:
    return {
        "clinic_name": settings.clinic_name,
        "agent_name": settings.clinic_agent_name,
        "now": clinic_now().isoformat(),
        "phone": settings.clinic_phone,
        "address": settings.clinic_address,
        "hours": settings.clinic_hours,
        "fees": settings.clinic_fees,
        "emergency_number": settings.emergency_number,
        "languages": [{"code": code, "name": LANGUAGE_NAMES[code]} for code in offered_languages()],
        "appointment_integration": settings.appointment_integration,
        # Callers asking for a person are transferred live (phone calls only)
        "human_transfer": bool(settings.human_transfer_number) and twilio_configured(),
    }


# ---------- Doctors ----------

class DoctorResponse(BaseModel):
    id: int
    name: str
    specialty: str
    qualification: Optional[str]
    treats: str
    working_days: List[int]
    start_time: str
    end_time: str
    slot_minutes: int
    consultation_fee: Optional[str]
    languages: Optional[str]
    is_active: bool

    class Config:
        from_attributes = True


class DoctorIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    specialty: str = Field(min_length=2, max_length=80)
    qualification: Optional[str] = Field(None, max_length=120)
    treats: str = Field("", max_length=1000)
    working_days: List[int] = Field(default_factory=list)
    start_time: str
    end_time: str
    slot_minutes: int = Field(15, ge=5, le=120)
    consultation_fee: Optional[str] = Field(None, max_length=60)
    languages: Optional[str] = Field(None, max_length=120)
    is_active: bool = True

    @field_validator("working_days")
    @classmethod
    def _days(cls, value: List[int]) -> List[int]:
        if any(day < 0 or day > 6 for day in value):
            raise ValueError("Days are 0 (Monday) to 6 (Sunday)")
        return sorted(set(value))

    @field_validator("start_time", "end_time")
    @classmethod
    def _time(cls, value: str) -> str:
        if not HHMM.match(value):
            raise ValueError("Use HH:MM (24-hour)")
        return value


def _check_hours(data: DoctorIn) -> None:
    if data.start_time >= data.end_time:
        raise HTTPException(status_code=400, detail="End time must be after start time")


@router.get("/doctors", response_model=List[DoctorResponse])
async def list_doctors(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    result = await db.execute(select(Doctor).order_by(Doctor.is_active.desc(), Doctor.id))
    return result.scalars().all()


@router.post("/doctors", response_model=DoctorResponse, status_code=201)
async def create_doctor(data: DoctorIn, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    _check_hours(data)
    doctor = Doctor(**data.model_dump())
    db.add(doctor)
    await db.commit()
    await db.refresh(doctor)
    return doctor


@router.put("/doctors/{doctor_id}", response_model=DoctorResponse)
async def update_doctor(
    doctor_id: int, data: DoctorIn, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    _check_hours(data)
    doctor = await db.get(Doctor, doctor_id)
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")
    for key, value in data.model_dump().items():
        setattr(doctor, key, value)
    await db.commit()
    await db.refresh(doctor)
    return doctor


@router.get("/doctors/{doctor_id}/availability")
async def doctor_availability(
    doctor_id: int,
    days: int = Query(7, ge=1, le=30),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> List[str]:
    doctor = await db.get(Doctor, doctor_id)
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")
    free = await get_free_slots(db, [doctor], days)
    return [slot.isoformat() for slot in free[doctor.id]]


# ---------- Knowledge base ----------

class KnowledgeResponse(BaseModel):
    id: int
    category: str
    title: str
    content: str
    sort_order: int
    is_active: bool
    updated_at: datetime

    class Config:
        from_attributes = True


class KnowledgeIn(BaseModel):
    category: str = Field("faq", pattern="^(" + "|".join(KNOWLEDGE_CATEGORIES) + ")$")
    title: str = Field(min_length=2, max_length=200)
    content: str = Field(min_length=2, max_length=2000)
    sort_order: int = 0
    is_active: bool = True


@router.get("/knowledge", response_model=List[KnowledgeResponse])
async def list_knowledge(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    result = await db.execute(
        select(ClinicKnowledge).order_by(ClinicKnowledge.category, ClinicKnowledge.sort_order, ClinicKnowledge.id)
    )
    return result.scalars().all()


@router.post("/knowledge", response_model=KnowledgeResponse, status_code=201)
async def create_knowledge(data: KnowledgeIn, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    item = ClinicKnowledge(**data.model_dump())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.put("/knowledge/{item_id}", response_model=KnowledgeResponse)
async def update_knowledge(
    item_id: int, data: KnowledgeIn, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    item = await db.get(ClinicKnowledge, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Entry not found")
    for key, value in data.model_dump().items():
        setattr(item, key, value)
    await db.commit()
    await db.refresh(item)
    return item


@router.delete("/knowledge/{item_id}", status_code=204)
async def delete_knowledge(item_id: int, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    item = await db.get(ClinicKnowledge, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Entry not found")
    await db.delete(item)
    await db.commit()
