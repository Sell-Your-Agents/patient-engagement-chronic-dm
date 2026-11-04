from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from datetime import datetime, timedelta, timezone
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
from app.models.next_outreach_schedule import NextOutreachSchedule

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
    purpose: Optional[str] = None
    duration_seconds: Optional[int] = None
    structured_summary: Optional[dict] = None
    created_at: Optional[datetime] = None

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

    return await place_call(db, patient, care_plan, purpose="checkin")


async def place_call(db: AsyncSession, patient: Patient, care_plan: CarePlan, purpose: str) -> OutreachCallResponse:
    """Create an OutreachCall record and have Twilio dial the patient."""
    twilio_configured = bool(
        settings.twilio_account_sid and settings.twilio_auth_token and settings.twilio_phone_number
    )
    if twilio_configured and settings.api_base_url.startswith("http://localhost"):
        raise HTTPException(
            status_code=400,
            detail="API_BASE_URL must be your public ngrok https URL so Twilio can reach the backend",
        )

    # Create OutreachCall record
    outreach_call = OutreachCall(
        patient_id=patient.id,
        care_plan_id=care_plan.id,
        channel="voice",
        purpose=purpose,
        status="initiated",
    )
    db.add(outreach_call)
    await db.flush()

    try:
        # Check if Twilio credentials are available
        if not twilio_configured:
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
            status_callback=f"{settings.api_base_url}/twilio/status",
            status_callback_method="POST",
            status_callback_event=["ringing", "answered", "completed"],
            record=True,
            timeout=30,
        )

        outreach_call.call_sid = call.sid
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


# ---------- Feedback callbacks (from Call Logs) ----------

async def feedback_target(db: AsyncSession, patient_id: int, care_plan_id: Optional[int]):
    """Patient and care plan for a feedback callback; raises if the patient cannot be called."""
    patient = await db.get(Patient, patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    if not patient.communication_consent:
        raise HTTPException(status_code=403, detail="Patient has not consented to communication")

    care_plan = await db.get(CarePlan, care_plan_id) if care_plan_id else None
    if not care_plan or care_plan.status != "active":
        result = await db.execute(
            select(CarePlan).where(CarePlan.patient_id == patient_id, CarePlan.status == "active").limit(1)
        )
        care_plan = result.scalar_one_or_none()
    if not care_plan:
        raise HTTPException(status_code=400, detail="Patient has no active care plans")
    return patient, care_plan


async def get_source_call(db: AsyncSession, call_id: int) -> OutreachCall:
    call = await db.get(OutreachCall, call_id)
    if not call:
        raise HTTPException(status_code=404, detail="Outreach call not found")
    return call


class ScheduleFeedbackRequest(BaseModel):
    scheduled_at: datetime
    notes: Optional[str] = None


class FeedbackScheduleResponse(BaseModel):
    id: int
    patient_id: int
    patient_name: str
    scheduled_time: datetime
    status: str
    source_outreach_call_id: Optional[int]
    notes: Optional[str]
    created_at: datetime


def _schedule_out(schedule: NextOutreachSchedule, patient: Optional[Patient]) -> FeedbackScheduleResponse:
    return FeedbackScheduleResponse(
        id=schedule.id,
        patient_id=schedule.patient_id,
        patient_name=f"{patient.first_name} {patient.last_name}" if patient else f"Patient #{schedule.patient_id}",
        scheduled_time=schedule.scheduled_time,
        status=schedule.status,
        source_outreach_call_id=schedule.source_outreach_call_id,
        notes=schedule.notes,
        created_at=schedule.created_at,
    )


@router.post("/{id}/feedback-callback")
async def feedback_callback_now(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user: CareTeamUser = Depends(get_current_user),
) -> OutreachCallResponse:
    """Call the patient from this call log back now to collect feedback."""
    source = await get_source_call(db, id)
    patient, care_plan = await feedback_target(db, source.patient_id, source.care_plan_id)
    return await place_call(db, patient, care_plan, purpose="feedback")


@router.post("/{id}/feedback-callback/schedule")
async def schedule_feedback_callback(
    id: int,
    request: ScheduleFeedbackRequest,
    db: AsyncSession = Depends(get_db),
    current_user: CareTeamUser = Depends(get_current_user),
) -> FeedbackScheduleResponse:
    """Schedule a feedback callback for the patient from this call log."""
    source = await get_source_call(db, id)
    patient, care_plan = await feedback_target(db, source.patient_id, source.care_plan_id)

    scheduled_at = request.scheduled_at
    if scheduled_at.tzinfo:
        scheduled_at = scheduled_at.astimezone(timezone.utc).replace(tzinfo=None)
    if scheduled_at < datetime.utcnow() - timedelta(minutes=1):
        raise HTTPException(status_code=400, detail="Scheduled time must be in the future")

    schedule = NextOutreachSchedule(
        patient_id=patient.id,
        care_plan_id=care_plan.id,
        scheduled_time=scheduled_at,
        schedule_type="feedback",
        max_attempts=1,
        status="pending",
        source_outreach_call_id=source.id,
        notes=request.notes or f"Assigned by {current_user.name}",
    )
    db.add(schedule)
    await db.commit()
    await db.refresh(schedule)
    return _schedule_out(schedule, patient)


@router.get("/feedback-schedules")
async def list_feedback_schedules(
    db: AsyncSession = Depends(get_db),
    current_user: CareTeamUser = Depends(get_current_user),
) -> List[FeedbackScheduleResponse]:
    result = await db.execute(
        select(NextOutreachSchedule, Patient)
        .join(Patient, Patient.id == NextOutreachSchedule.patient_id)
        .where(NextOutreachSchedule.schedule_type == "feedback")
        .order_by(NextOutreachSchedule.scheduled_time.desc())
        .limit(200)
    )
    return [_schedule_out(schedule, patient) for schedule, patient in result.all()]


@router.delete("/feedback-schedules/{schedule_id}")
async def cancel_feedback_schedule(
    schedule_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: CareTeamUser = Depends(get_current_user),
) -> FeedbackScheduleResponse:
    schedule = await db.get(NextOutreachSchedule, schedule_id)
    if not schedule or schedule.schedule_type != "feedback":
        raise HTTPException(status_code=404, detail="Scheduled callback not found")
    if schedule.status != "pending":
        raise HTTPException(status_code=400, detail=f"Callback is already {schedule.status}")
    schedule.status = "cancelled"
    await db.commit()
    return _schedule_out(schedule, await db.get(Patient, schedule.patient_id))


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

    query = query.order_by(OutreachCall.created_at.desc()).offset(skip).limit(limit)
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
