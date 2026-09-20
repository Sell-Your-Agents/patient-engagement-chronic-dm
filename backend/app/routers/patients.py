from fastapi import APIRouter, HTTPException, status, Depends
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.patient import Patient
from app.deps import get_current_user
from app.models.care_team_user import CareTeamUser

router = APIRouter(prefix="/api/patients", tags=["patients"])


class PatientCreate(BaseModel):
    mrn: str
    first_name: str
    last_name: str
    phone_number: str
    preferred_language: str = "en"


class PatientUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone_number: Optional[str] = None
    preferred_language: Optional[str] = None
    status: Optional[str] = None


class PatientResponse(BaseModel):
    id: int
    mrn: str
    first_name: str
    last_name: str
    phone_number: str
    preferred_language: str
    status: str

    class Config:
        from_attributes = True


@router.get("/", response_model=List[PatientResponse])
async def list_patients(
    db: AsyncSession = Depends(get_db),
    _current_user: CareTeamUser = Depends(get_current_user),
):
    result = await db.execute(select(Patient).limit(100))
    patients = result.scalars().all()
    return patients


@router.post("/", response_model=PatientResponse, status_code=status.HTTP_201_CREATED)
async def create_patient(
    patient_data: PatientCreate,
    db: AsyncSession = Depends(get_db),
    _current_user: CareTeamUser = Depends(get_current_user),
):
    new_patient = Patient(**patient_data.dict())
    db.add(new_patient)
    await db.commit()
    await db.refresh(new_patient)
    return new_patient


@router.get("/{patient_id}", response_model=PatientResponse)
async def get_patient(
    patient_id: int,
    db: AsyncSession = Depends(get_db),
    _current_user: CareTeamUser = Depends(get_current_user),
):
    result = await db.execute(select(Patient).where(Patient.id == patient_id))
    patient = result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    return patient


@router.patch("/{patient_id}", response_model=PatientResponse)
async def update_patient(
    patient_id: int,
    patient_data: PatientUpdate,
    db: AsyncSession = Depends(get_db),
    _current_user: CareTeamUser = Depends(get_current_user),
):
    result = await db.execute(select(Patient).where(Patient.id == patient_id))
    patient = result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")

    # Update only provided fields
    update_data = patient_data.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(patient, field, value)

    await db.commit()
    await db.refresh(patient)
    return patient
