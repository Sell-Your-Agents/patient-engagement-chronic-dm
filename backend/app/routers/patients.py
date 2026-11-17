"""Patients: people who have called the clinic (created after a call) or were added by staff."""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.database import get_db
from app.models.appointment import Appointment
from app.models.call_log import CallLog
from app.models.callback_schedule import FollowUp
from app.models.patient import Patient
from app.models.user import User
from app.routers.clinic import normalize_phone

router = APIRouter(prefix="/api/patients", tags=["patients"])

LANGUAGE_PATTERN = "^(en|hi|te)$"


class PatientCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    phone_number: str = Field(min_length=6, max_length=20)
    preferred_language: str = Field("en", pattern=LANGUAGE_PATTERN)
    notes: Optional[str] = Field(None, max_length=2000)


class PatientUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    phone_number: Optional[str] = Field(None, min_length=6, max_length=20)
    preferred_language: Optional[str] = Field(None, pattern=LANGUAGE_PATTERN)
    notes: Optional[str] = Field(None, max_length=2000)


class PatientResponse(BaseModel):
    id: int
    name: str
    phone_number: str
    preferred_language: str
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime
    call_count: int = 0
    last_call_at: Optional[datetime] = None
    # Why they called last time (call intent, e.g. appointment_booking)
    last_call_intent: Optional[str] = None
    open_appointments: int = 0

    class Config:
        from_attributes = True


@router.get("/", response_model=List[PatientResponse])
async def list_patients(
    q: Optional[str] = Query(None, max_length=120, description="Part of the name or phone number"),
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    calls = (
        select(CallLog.patient_id, func.count(CallLog.id).label("n"), func.max(CallLog.created_at).label("last"))
        .group_by(CallLog.patient_id)
        .subquery()
    )
    open_appts = (
        select(Appointment.patient_id, func.count(Appointment.id).label("n"))
        .where(Appointment.status.in_(("pending", "confirmed")))
        .group_by(Appointment.patient_id)
        .subquery()
    )
    query = (
        select(Patient, calls.c.n, calls.c.last, open_appts.c.n)
        .outerjoin(calls, calls.c.patient_id == Patient.id)
        .outerjoin(open_appts, open_appts.c.patient_id == Patient.id)
        .order_by(func.coalesce(calls.c.last, Patient.created_at).desc())
    )
    if q and q.strip():
        term = q.strip()
        digits = "".join(ch for ch in term if ch.isdigit())
        conditions = [Patient.name.ilike(f"%{term}%")]
        if digits:
            conditions.append(Patient.phone_number.like(f"%{digits}%"))
        query = query.where(or_(*conditions))
    rows = (await db.execute(query.offset(skip).limit(limit))).all()
    intents = await _last_intents(db, [patient.id for patient, *_ in rows])
    out = []
    for patient, n_calls, last, n_open in rows:
        item = PatientResponse.model_validate(patient)
        item.call_count = n_calls or 0
        item.last_call_at = last
        item.last_call_intent = intents.get(patient.id)
        item.open_appointments = n_open or 0
        out.append(item)
    return out


async def _last_intents(db: AsyncSession, patient_ids: List[int]) -> dict:
    """The intent of each patient's most recent call that has one."""
    if not patient_ids:
        return {}
    result = await db.execute(
        select(CallLog.patient_id, CallLog.intent)
        .where(CallLog.patient_id.in_(patient_ids), CallLog.intent.is_not(None))
        .order_by(CallLog.patient_id, CallLog.created_at.desc())
    )
    intents: dict = {}
    for patient_id, intent in result.all():
        intents.setdefault(patient_id, intent)
    return intents


@router.post("/", response_model=PatientResponse, status_code=status.HTTP_201_CREATED)
async def create_patient(data: PatientCreate, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    patient = Patient(
        name=data.name.strip(),
        phone_number=normalize_phone(data.phone_number),
        preferred_language=data.preferred_language,
        notes=data.notes,
    )
    db.add(patient)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="A patient with this phone number already exists")
    await db.refresh(patient)
    return PatientResponse.model_validate(patient)


@router.get("/{patient_id}", response_model=PatientResponse)
async def get_patient(patient_id: int, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    patient = await db.get(Patient, patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    item = PatientResponse.model_validate(patient)
    n_calls, last = (
        await db.execute(select(func.count(CallLog.id), func.max(CallLog.created_at)).where(CallLog.patient_id == patient_id))
    ).one()
    item.call_count, item.last_call_at = n_calls or 0, last
    item.open_appointments = (
        await db.execute(
            select(func.count(Appointment.id)).where(
                Appointment.patient_id == patient_id, Appointment.status.in_(("pending", "confirmed"))
            )
        )
    ).scalar() or 0
    return item


@router.patch("/{patient_id}", response_model=PatientResponse)
async def update_patient(
    patient_id: int, data: PatientUpdate, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    patient = await db.get(Patient, patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    if data.name is not None:
        patient.name = data.name.strip()
    if data.phone_number is not None:
        patient.phone_number = normalize_phone(data.phone_number)
    if data.preferred_language is not None:
        patient.preferred_language = data.preferred_language
    if data.notes is not None:
        patient.notes = data.notes
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="A patient with this phone number already exists")
    await db.refresh(patient)
    return PatientResponse.model_validate(patient)


@router.get("/{patient_id}/follow-ups")
async def patient_follow_ups(patient_id: int, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    """Follow-up tasks for this patient (newest first); the full shape is in routers/followups.py."""
    from app.routers.followups import follow_up_out

    result = await db.execute(select(FollowUp).where(FollowUp.patient_id == patient_id).order_by(FollowUp.id.desc()))
    return [follow_up_out(task) for task in result.scalars().all()]
