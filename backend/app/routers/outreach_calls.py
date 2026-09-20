from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List, Dict
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
import twilio.rest

from app.database import get_db
from app.config import get_settings
from app.deps import get_current_user
from app.models.care_team_user import CareTeamUser
from app.models.outreach_call import OutreachCall
from app.models.care_plan import CarePlan
from app.models.patient import Patient

settings = get_settings()
router = APIRouter(prefix="/api/outreach-calls", tags=["outreach_calls"])
twilio_client = twilio.rest.Client(settings.twilio_account_sid, settings.twilio_auth_token)


class InitiateCallRequest(BaseModel):
    patient_id: int
    care_plan_id: Optional[int] = None
    reason: str = "routine_checkup"


class OutreachCallResponse(BaseModel):
    id: int
    patient_id: int
    care_plan_id: Optional[int]
    call_sid: Optional[str]
    status: str
    started_at: Optional[datetime]
    ended_at: Optional[datetime]
    transcript: Optional[str]
    warning_signs_detected: bool
    medication_adherence_reported: Optional[str]
    csat_score: Optional[int]

    class Config:
        from_attributes = True


@router.post("/initiate")
async def initiate_call(
    request: InitiateCallRequest,
    db: AsyncSession = Depends(get_db),
    current_user: CareTeamUser = Depends(get_current_user),
) -> OutreachCallResponse:
    """Initiate an outbound call to a patient.

    Creates an OutreachCall record and triggers Twilio to dial the patient.
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

    care_plan = None
    if request.care_plan_id:
        plan_result = await db.execute(
            select(CarePlan).where(CarePlan.id == request.care_plan_id)
        )
        care_plan = plan_result.scalar_one_or_none()

        if not care_plan:
            raise HTTPException(status_code=404, detail="Care plan not found")

        if care_plan.patient_id != request.patient_id:
            raise HTTPException(status_code=400, detail="Care plan does not belong to this patient")
    else:
        # If no care plan specified, find the patient's first active care plan
        plan_result = await db.execute(
            select(CarePlan).where(
                CarePlan.patient_id == request.patient_id,
                CarePlan.status == "active"
            ).limit(1)
        )
        care_plan = plan_result.scalar_one_or_none()

        if not care_plan:
            raise HTTPException(status_code=400, detail="Patient has no active care plans")

    if care_plan and care_plan.patient_id != request.patient_id:
            raise HTTPException(
                status_code=400, detail="Care plan does not belong to patient"
            )

    # Create OutreachCall record
    outreach_call = OutreachCall(
        patient_id=request.patient_id,
        care_plan_id=request.care_plan_id,
        channel="voice",
        status="initiated",
    )
    db.add(outreach_call)
    await db.flush()

    try:
        # Check if Twilio credentials are available
        if not settings.twilio_account_sid or not settings.twilio_auth_token or not settings.twilio_phone_number:
            # Mock call for testing without Twilio credentials
            print(f"⚠️ Twilio not configured - creating mock call")
            outreach_call.status = "completed"
            outreach_call.call_sid = f"SM_mock_{outreach_call.id}"
            outreach_call.transcript = "[Mock call - Twilio not configured]"
            outreach_call.duration_seconds = 300
            await db.commit()
            return OutreachCallResponse.model_validate(outreach_call)

        # Initiate Twilio call
        call = twilio_client.calls.create(
            from_=settings.twilio_phone_number,
            to=patient.phone_number,
            url=f"{settings.api_base_url}/twilio/twiml",
            method="POST",
            record=True,
            timeout=30,
        )

        outreach_call.call_sid = call.sid
        outreach_call.status = "in_progress"
        await db.commit()

        return OutreachCallResponse.model_validate(outreach_call)

    except Exception as e:
        print(f"❌ Error initiating call: {e}")
        # Still create the record as failed, don't throw error
        outreach_call.status = "failed"
        await db.commit()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to initiate call: {str(e)}",
        )


@router.get("/")
async def list_outreach_calls(
    db: AsyncSession = Depends(get_db),
    current_user: CareTeamUser = Depends(get_current_user),
    patient_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    warning_signs_only: bool = Query(False),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
) -> List[OutreachCallResponse]:
    """List outreach calls with optional filters."""
    query = select(OutreachCall)

    if patient_id:
        query = query.where(OutreachCall.patient_id == patient_id)

    if status:
        query = query.where(OutreachCall.status == status)

    if warning_signs_only:
        query = query.where(OutreachCall.warning_signs_detected == True)

    query = query.offset(skip).limit(limit)
    result = await db.execute(query)
    calls = result.scalars().all()

    return [OutreachCallResponse.model_validate(call) for call in calls]


@router.get("/{id}")
async def get_outreach_call(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user: CareTeamUser = Depends(get_current_user),
) -> OutreachCallResponse:
    """Get details of a specific outreach call."""
    result = await db.execute(
        select(OutreachCall).where(OutreachCall.id == id)
    )
    call = result.scalar_one_or_none()

    if not call:
        raise HTTPException(status_code=404, detail="Outreach call not found")

    return OutreachCallResponse.model_validate(call)


@router.get("/stats/summary")
async def call_stats_summary(
    db: AsyncSession = Depends(get_db),
    current_user: CareTeamUser = Depends(get_current_user),
) -> Dict:
    """Get summary statistics for outreach calls."""
    # Total calls
    total_result = await db.execute(select(func.count(OutreachCall.id)))
    total_calls = total_result.scalar() or 0

    # Completed calls
    completed_result = await db.execute(
        select(func.count(OutreachCall.id)).where(
            OutreachCall.status == "completed"
        )
    )
    completed_calls = completed_result.scalar() or 0

    # Calls with warning signs
    warning_result = await db.execute(
        select(func.count(OutreachCall.id)).where(
            OutreachCall.warning_signs_detected == True
        )
    )
    warning_signs_calls = warning_result.scalar() or 0

    # Average CSAT
    csat_result = await db.execute(
        select(func.avg(OutreachCall.csat_score)).where(
            OutreachCall.csat_score.isnot(None)
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
