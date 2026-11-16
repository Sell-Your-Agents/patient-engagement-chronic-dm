"""Unified calls API: every call, inbound (Maya) and outbound (health check-in), from one table.

GET / and GET /stats take ?direction=inbound|outbound; POST / dials an enrolled patient (outbound).
/callbacks lists the callbacks callers asked for (and failed-call retries) so staff can act on them.
"""
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.auth.deps import get_current_user
from app.models.call_log import CallLog, CallTurn, DIRECTION_OUTBOUND
from app.models.callback_schedule import (
    CallbackSchedule,
    CALLBACK_CANCELLED,
    CALLBACK_COMPLETED,
    CALLBACK_PENDING,
)
from app.services.scheduling.callback_service import (
    CallbackBusyError,
    claim_callback,
    dial_callback,
    place_agent_call,
    schedule_staff_callback,
)
from app.services.scheduling.clinic_scheduling import clinic_now
from app.models.patient import Patient
from app.models.plan import Plan
from app.models.user import User

settings = get_settings()
router = APIRouter(prefix="/api/calls", tags=["calls"])

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

        # Same dialling as scheduled calls: status callback (no-answer detection) and the recording setting
        call_log.call_sid = await place_agent_call(patient.phone_number)
        call_log.status = "initiated"  # becomes "in-progress" when the patient answers (/twilio/twiml)
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


class CallPage(BaseModel):
    items: List[CallResponse]
    total: int
    page: int
    page_size: int
    #: Matching calls per direction (same filters, ignoring the direction tab)
    counts: Dict[str, int]


def _as_utc_naive(value: Optional[datetime]) -> Optional[datetime]:
    """Call timestamps are stored as naive UTC; accept aware or naive input."""
    if value is None:
        return None
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


@router.get("/page", response_model=CallPage)
async def search_calls(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    direction: Optional[str] = Query(None, pattern=DIRECTION_PATTERN),
    date_from: Optional[datetime] = Query(None, description="Calls at or after this time (ISO 8601)"),
    date_to: Optional[datetime] = Query(None, description="Calls before this time (ISO 8601)"),
    name: Optional[str] = Query(None, max_length=120, description="Part of the patient's name"),
    mrn: Optional[str] = Query(None, max_length=50, description="Part of the patient's MRN"),
    phone: Optional[str] = Query(None, max_length=30, description="Part of the phone number"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Call log search, paged on the server. Newest first."""
    when = func.coalesce(CallLog.started_at, CallLog.created_at)
    filters = []
    start, end = _as_utc_naive(date_from), _as_utc_naive(date_to)
    if start:
        filters.append(when >= start)
    if end:
        filters.append(when < end)
    if name and name.strip():
        filters.append(CallLog.patient_name.ilike(f"%{name.strip()}%"))
    if phone and phone.strip():
        digits = "".join(ch for ch in phone if ch.isdigit())
        if digits:
            filters.append(func.replace(func.replace(CallLog.phone_number, " ", ""), "-", "").ilike(f"%{digits}%"))
    if mrn and mrn.strip():
        patient_ids = select(Patient.id).where(Patient.mrn.ilike(f"%{mrn.strip()}%"))
        filters.append(CallLog.patient_id.in_(patient_ids))

    # Per-direction counts for the tabs
    count_rows = await db.execute(select(CallLog.direction, func.count(CallLog.id)).where(*filters).group_by(CallLog.direction))
    by_direction = {d: n for d, n in count_rows.all()}
    counts = {"all": sum(by_direction.values()), "outbound": by_direction.get("outbound", 0), "inbound": by_direction.get("inbound", 0)}

    if direction:
        filters.append(CallLog.direction == direction)
    total = counts[direction] if direction else counts["all"]
    result = await db.execute(
        select(CallLog).where(*filters).order_by(when.desc(), CallLog.id.desc()).offset((page - 1) * page_size).limit(page_size)
    )
    return {"items": result.scalars().all(), "total": total, "page": page, "page_size": page_size, "counts": counts}


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


class CallbackResponse(BaseModel):
    id: int
    patient_id: Optional[int]
    plan_id: Optional[int]
    patient_name: Optional[str]
    phone_number: Optional[str]
    scheduled_time: datetime  # local clinic time
    schedule_type: str
    status: str
    attempt_number: int
    max_attempts: int
    notes: Optional[str]
    source_call_log_id: Optional[int]
    call_log_id: Optional[int]  # latest call the agent placed for it
    created_at: datetime


class CallbackUpdate(BaseModel):
    status: Optional[str] = Field(None, pattern=f"^({CALLBACK_PENDING}|{CALLBACK_COMPLETED}|{CALLBACK_CANCELLED})$")
    scheduled_time: Optional[datetime] = None


class CallFollowUpRequest(BaseModel):
    # Local clinic time; ignored when call_now is set
    scheduled_time: Optional[datetime] = None
    reason: Optional[str] = Field(None, max_length=500)
    call_now: bool = False


def _callback_response(callback: CallbackSchedule, patient: Optional[Patient]) -> CallbackResponse:
    return CallbackResponse(
        id=callback.id,
        patient_id=callback.patient_id,
        plan_id=callback.plan_id,
        patient_name=callback.patient_name
        or (f"{patient.first_name} {patient.last_name}" if patient else None),
        phone_number=callback.phone_number or (patient.phone_number if patient else None),
        scheduled_time=callback.scheduled_time,
        schedule_type=callback.schedule_type,
        status=callback.status,
        attempt_number=callback.attempt_number,
        max_attempts=callback.max_attempts,
        notes=callback.notes,
        source_call_log_id=callback.source_outreach_call_log_id,
        call_log_id=callback.call_log_id,
        created_at=callback.created_at,
    )


async def _get_callback(db: AsyncSession, callback_id: int) -> CallbackSchedule:
    callback = await db.get(CallbackSchedule, callback_id)
    if not callback:
        raise HTTPException(status_code=404, detail="Callback not found")
    return callback


@router.get("/callbacks", response_model=List[CallbackResponse])
async def list_callbacks(
    status: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Scheduled callbacks, soonest first."""
    query = (
        select(CallbackSchedule, Patient)
        .outerjoin(Patient, Patient.id == CallbackSchedule.patient_id)
        .order_by(CallbackSchedule.scheduled_time)
    )
    if status:
        query = query.where(CallbackSchedule.status == status)
    result = await db.execute(query.limit(500))
    return [_callback_response(callback, patient) for callback, patient in result.all()]


@router.patch("/callbacks/{callback_id}", response_model=CallbackResponse)
async def update_callback(
    callback_id: int,
    update: CallbackUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Mark a callback done / cancelled, or move it."""
    callback = await _get_callback(db, callback_id)
    if update.status:
        callback.status = update.status
    if update.scheduled_time:
        callback.scheduled_time = update.scheduled_time.replace(tzinfo=None)
    await db.commit()
    patient = await db.get(Patient, callback.patient_id) if callback.patient_id else None
    return _callback_response(callback, patient)


@router.post("/callbacks/{callback_id}/dial", response_model=CallResponse)
async def dial_callback_now(
    callback_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Have the agent call this person back now instead of at the scheduled time."""
    await _get_callback(db, callback_id)
    if not await claim_callback(db, callback_id):
        raise HTTPException(status_code=400, detail="This callback is no longer pending")
    callback = await db.get(CallbackSchedule, callback_id)
    return await dial_callback(db, callback)


@router.post("/{call_log_id}/callback", response_model=CallbackResponse)
async def follow_up_call(
    call_log_id: int,
    request: CallFollowUpRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Staff follow-up from the call log: have the agent call this person back at a set time, or now."""
    call = await db.get(CallLog, call_log_id)
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    if not call.phone_number and not call.patient_id:
        raise HTTPException(status_code=400, detail="This call has no phone number to call back")

    if request.call_now:
        when = clinic_now()
    elif request.scheduled_time:
        when = request.scheduled_time.replace(tzinfo=None, second=0, microsecond=0)
        if when <= clinic_now():
            raise HTTPException(status_code=400, detail="Pick a time in the future")
    else:
        raise HTTPException(status_code=400, detail="Pick a callback time or choose Call now")

    try:
        callback = await schedule_staff_callback(db, call, when, (request.reason or "").strip() or None)
    except CallbackBusyError as err:
        raise HTTPException(status_code=409, detail=str(err))
    await db.commit()

    if request.call_now and await claim_callback(db, callback.id):
        await dial_callback(db, callback)
        await db.refresh(callback)

    patient = await db.get(Patient, callback.patient_id) if callback.patient_id else None
    return _callback_response(callback, patient)


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
