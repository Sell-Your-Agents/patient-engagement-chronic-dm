"""Unified calls API: every call, inbound (Maya) and outbound (health check-in), from one table.

GET / and GET /stats take ?direction=inbound|outbound; POST / dials an enrolled patient (outbound).
"""
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
import twilio.rest

from app.config import get_settings
from app.database import get_db
from app.deps import get_current_user
from app.models.call_log import CallLog, CallTurn, DIRECTION_OUTBOUND
from app.models.patient import Patient
from app.models.plan import Plan
from app.models.user import User

settings = get_settings()
router = APIRouter(prefix="/api/calls", tags=["calls"])
twilio_client = twilio.rest.Client(settings.twilio_account_sid, settings.twilio_auth_token)

DIRECTION_PATTERN = "^(inbound|outbound)$"


class InitiateCallRequest(BaseModel):
    patient_id: int
    plan_id: Optional[int] = None
    reason: str = "routine_checkup"


class CallResponse(BaseModel):
    id: int
    direction: str
    phone_number: Optional[str]
    patient_id: Optional[int]
    patient_name: Optional[str]
    plan_id: Optional[int]
    call_sid: Optional[str]
    status: str
    reason: Optional[str]
    urgency: Optional[str]
    outcome: Optional[str]
    summary: Optional[str]
    transcript: Optional[str]
    warning_signs_detected: bool
    medication_adherence_reported: Optional[str]
    csat_score: Optional[int]
    started_at: Optional[datetime]
    ended_at: Optional[datetime]
    duration_seconds: Optional[int]
    created_at: datetime

    class Config:
        from_attributes = True


class CallTurnResponse(BaseModel):
    role: str
    content: str
    timestamp: datetime

    class Config:
        from_attributes = True


class CallDetailResponse(CallResponse):
    structured_summary: Optional[dict]
    turns: List[CallTurnResponse] = []


@router.post("/", response_model=CallResponse)
async def initiate_outbound_call(
    request: InitiateCallRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Initiate an outbound call to a patient.

    Creates an outbound CallLog record and triggers Twilio to dial the patient.
    """
    # Get patient and care plan
    patient_result = await db.execute(
        select(Patient).where(Patient.id == request.patient_id)
    )
    patient = patient_result.scalar_one_or_none()

    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    if not patient.communication_consent:
        raise HTTPException(
            status_code=403,
            detail="Patient has not consented to communication",
        )

    plan = None
    if request.plan_id:
        plan_result = await db.execute(
            select(Plan).where(Plan.id == request.plan_id)
        )
        plan = plan_result.scalar_one_or_none()

        if not plan:
            raise HTTPException(status_code=404, detail="Care plan not found")

        if plan.patient_id != request.patient_id:
            raise HTTPException(status_code=400, detail="Care plan does not belong to this patient")
    else:
        # If no care plan specified, find the patient's first active care plan
        plan_result = await db.execute(
            select(Plan).where(
                Plan.patient_id == request.patient_id,
                Plan.status == "active"
            ).limit(1)
        )
        plan = plan_result.scalar_one_or_none()

        if not plan:
            raise HTTPException(status_code=400, detail="Patient has no active care plans")

    if plan and plan.patient_id != request.patient_id:
            raise HTTPException(
                status_code=400, detail="Care plan does not belong to patient"
            )

    # Create the outbound CallLog record
    call_log = CallLog(
        direction=DIRECTION_OUTBOUND,
        patient_id=request.patient_id,
        phone_number=patient.phone_number,
        plan_id=plan.id,
        channel="voice",
        status="initiated",
    )
    db.add(call_log)
    await db.flush()

    try:
        # Check if Twilio credentials are available
        if not settings.twilio_account_sid or not settings.twilio_auth_token or not settings.twilio_phone_number:
            # Mock call for testing without Twilio credentials
            print(f"⚠️ Twilio not configured - creating mock call")
            call_log.status = "completed"
            call_log.call_sid = f"SM_mock_{call_log.id}"
            call_log.transcript = "[Mock call - Twilio not configured]"
            call_log.duration_seconds = 300
            await db.commit()
            return CallResponse.model_validate(call_log)

        # Initiate Twilio call
        call = twilio_client.calls.create(
            from_=settings.twilio_phone_number,
            to=patient.phone_number,
            url=f"{settings.api_base_url}/twilio/twiml",
            method="POST",
            record=True,
            timeout=30,
        )

        call_log.call_sid = call.sid
        call_log.status = "in_progress"
        await db.commit()

        return CallResponse.model_validate(call_log)

    except Exception as e:
        print(f"❌ Error initiating call: {e}")
        # Still create the record as failed, don't throw error
        call_log.status = "failed"
        await db.commit()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to initiate call: {str(e)}",
        )


@router.get("/", response_model=List[CallResponse])
async def list_calls(
    direction: Optional[str] = Query(None, pattern=DIRECTION_PATTERN),
    patient_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    warning_signs_only: bool = Query(False),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """All calls, newest first. Filter by direction (inbound/outbound), patient, status or warning signs."""
    query = select(CallLog).order_by(CallLog.created_at.desc())
    if direction:
        query = query.where(CallLog.direction == direction)
    if patient_id:
        query = query.where(CallLog.patient_id == patient_id)
    if status:
        query = query.where(CallLog.status == status)
    if warning_signs_only:
        query = query.where(CallLog.warning_signs_detected == True)
    result = await db.execute(query.offset(skip).limit(limit))
    return result.scalars().all()


@router.get("/stats")
async def call_stats(
    direction: Optional[str] = Query(None, pattern=DIRECTION_PATTERN),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> Dict:
    """Summary statistics, optionally limited to one direction."""
    scope = CallLog.direction == direction if direction else CallLog.id.is_not(None)

    # Total calls
    total_result = await db.execute(select(func.count(CallLog.id)).where(scope))
    total_calls = total_result.scalar() or 0

    # Completed calls
    completed_result = await db.execute(
        select(func.count(CallLog.id)).where(scope).where(
            CallLog.status == "completed"
        )
    )
    completed_calls = completed_result.scalar() or 0

    # Calls with warning signs
    warning_result = await db.execute(
        select(func.count(CallLog.id)).where(scope).where(
            CallLog.warning_signs_detected == True
        )
    )
    warning_signs_calls = warning_result.scalar() or 0

    # Average CSAT
    csat_result = await db.execute(
        select(func.avg(CallLog.csat_score)).where(
            scope, CallLog.csat_score.isnot(None)
        )
    )
    avg_csat = csat_result.scalar() or 0

    completion_rate = (
        (completed_calls / total_calls * 100) if total_calls > 0 else 0
    )

    return {
        "total_calls": total_calls,
        "completed_calls": completed_calls,
        "completion_rate": round(completion_rate, 2),
        "calls_with_warning_signs": warning_signs_calls,
        "average_csat": round(avg_csat, 2) if avg_csat else None,
    }


@router.get("/{call_log_id}", response_model=CallDetailResponse)
async def get_call(
    call_log_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    call = await db.get(CallLog, call_log_id)
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    turns = await db.execute(
        select(CallTurn).where(CallTurn.call_log_id == call_log_id).order_by(CallTurn.timestamp, CallTurn.id)
    )
    detail = CallDetailResponse.model_validate(call)
    detail.turns = [CallTurnResponse.model_validate(t) for t in turns.scalars().all()]
    return detail
