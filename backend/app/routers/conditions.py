from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field
from datetime import datetime

from app.database import get_db
from app.models.condition import ChronicCondition, PatientCondition
from app.models.disease_protocol import DiseaseProtocol
from app.models.patient import Patient
from app.models.plan import Plan
from app.services.scheduling.clinic_scheduling import at_clinic_time, next_followup_due
from app.auth.deps import get_current_user
from app.models.user import User

router = APIRouter(prefix="/api/conditions", tags=["conditions"])


class ConditionResponse(BaseModel):
    id: int
    code: str
    display_name: str
    is_active: bool

    class Config:
        from_attributes = True


class ProtocolSummary(BaseModel):
    id: int
    version: int
    default_followup_interval_days: int
    default_followup_interval_minutes: Optional[int] = None
    default_call_time: Optional[str]
    assessment_questions: list
    red_flag_criteria: list
    education_talking_points: list
    medication_classes: list
    lab_reminder_defaults: Optional[dict]
    escalation_instructions: str

    class Config:
        from_attributes = True


class ProtocolUpdate(BaseModel):
    default_followup_interval_days: Optional[int] = Field(None, ge=1, le=365)
    # Repeat every N minutes instead of days; null goes back to days
    default_followup_interval_minutes: Optional[int] = Field(None, ge=1, le=1440)
    # "HH:MM" clinic local time; null clears it
    default_call_time: Optional[str] = Field(None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    # Also update the interval / call time of this disease's active plans
    apply_to_plans: bool = False


class ConditionPlan(BaseModel):
    plan_id: int
    patient_id: int
    patient_name: str
    severity: Optional[str]
    followup_interval_days: int
    followup_interval_minutes: Optional[int] = None
    next_due_date: datetime
    last_outreach_at: Optional[datetime]
    status: str
    assigned_physician_name: Optional[str]
    notes: Optional[str]


class ConditionOverview(BaseModel):
    id: int
    code: str
    display_name: str
    description: Optional[str]
    protocol: Optional[ProtocolSummary]
    plans: List[ConditionPlan]


@router.get("/", response_model=List[ConditionResponse])
async def list_conditions(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(
        select(ChronicCondition).where(ChronicCondition.is_active == True)
    )
    return result.scalars().all()


@router.get("/overview", response_model=List[ConditionOverview])
async def conditions_overview(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Each active disease with its active protocol and the patient plans following it."""
    conditions = (
        await db.execute(
            select(ChronicCondition)
            .where(ChronicCondition.is_active == True)
            .order_by(ChronicCondition.display_name)
        )
    ).scalars().all()

    protocols = (
        await db.execute(
            select(DiseaseProtocol)
            .where(DiseaseProtocol.is_active == True)
            .order_by(DiseaseProtocol.version)
        )
    ).scalars().all()
    # Highest active version wins
    protocol_by_condition = {p.condition_id: p for p in protocols}

    plan_rows = (
        await db.execute(
            select(Plan, PatientCondition, Patient)
            .join(PatientCondition, Plan.patient_condition_id == PatientCondition.id)
            .join(Patient, Plan.patient_id == Patient.id)
            .order_by(Plan.next_due_date)
        )
    ).all()
    plans_by_condition: dict[int, list[ConditionPlan]] = {}
    for plan, pc, patient in plan_rows:
        plans_by_condition.setdefault(pc.condition_id, []).append(
            ConditionPlan(
                plan_id=plan.id,
                patient_id=patient.id,
                patient_name=f"{patient.first_name} {patient.last_name}",
                severity=pc.severity,
                followup_interval_days=plan.followup_interval_days,
                followup_interval_minutes=plan.followup_interval_minutes,
                next_due_date=plan.next_due_date,
                last_outreach_at=plan.last_outreach_at,
                status=plan.status,
                assigned_physician_name=plan.assigned_physician_name,
                notes=plan.notes,
            )
        )

    return [
        ConditionOverview(
            id=c.id,
            code=c.code,
            display_name=c.display_name,
            description=c.description,
            protocol=(
                ProtocolSummary.model_validate(protocol_by_condition[c.id])
                if c.id in protocol_by_condition
                else None
            ),
            plans=plans_by_condition.get(c.id, []),
        )
        for c in conditions
    ]


@router.patch("/{condition_id}/protocol", response_model=ProtocolSummary)
async def update_protocol(
    condition_id: int,
    data: ProtocolUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    protocol = (
        await db.execute(
            select(DiseaseProtocol)
            .where(DiseaseProtocol.condition_id == condition_id, DiseaseProtocol.is_active == True)
            .order_by(DiseaseProtocol.version.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if not protocol:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active protocol for this disease")

    update_data = data.model_dump(exclude_unset=True, exclude={"apply_to_plans"})
    if update_data.get("default_followup_interval_days") is not None:
        protocol.default_followup_interval_days = update_data["default_followup_interval_days"]
    if "default_followup_interval_minutes" in update_data:
        protocol.default_followup_interval_minutes = update_data["default_followup_interval_minutes"]
    if "default_call_time" in update_data:
        protocol.default_call_time = update_data["default_call_time"]

    if data.apply_to_plans:
        plans = (
            await db.execute(
                select(Plan)
                .join(PatientCondition, Plan.patient_condition_id == PatientCondition.id)
                .where(PatientCondition.condition_id == condition_id, Plan.status == "active")
            )
        ).scalars().all()
        for plan in plans:
            plan.followup_interval_days = protocol.default_followup_interval_days
            plan.followup_interval_minutes = protocol.default_followup_interval_minutes
            # Already called once: next call is one (new) interval after that; otherwise keep the date
            plan.next_due_date = (
                next_followup_due(
                    plan.last_outreach_at,
                    plan.followup_interval_days,
                    protocol.default_call_time,
                    plan.followup_interval_minutes,
                )
                if plan.last_outreach_at
                else plan.next_due_date
                if plan.followup_interval_minutes
                else at_clinic_time(plan.next_due_date, protocol.default_call_time)
            )
            plan.adjusted_by_user_id = current_user.id

    await db.commit()
    await db.refresh(protocol)
    return protocol
