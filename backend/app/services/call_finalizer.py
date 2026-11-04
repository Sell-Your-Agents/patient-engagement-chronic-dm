from datetime import datetime, timedelta
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from app.models.appointment import Appointment, SOURCE_AGENT
from app.models.call_log import CallLog, DIRECTION_OUTBOUND
from app.models.plan import Plan
from app.models.condition import PatientCondition
from app.models.escalation import Escalation
from app.models.callback_schedule import CallbackSchedule
from app.services.claude_service import finalize_call_summary
from app.services.clinic_scheduling import find_doctor_by_name


async def finalize_call(
    call_log_id: int,
    db: AsyncSession,
    transcript: str,
    duration_seconds: int,
    recording_url: Optional[str] = None,
) -> dict:
    """Finalize any call, inbound or outbound: extract one structured summary and act on it.

    Records the summary on the call, raises an escalation for red flags or urgent callers,
    requests an appointment when the patient asked for one and none was booked during the call,
    and (outbound only) schedules the next plan follow-up.

    Returns:
        Summary dict with the action items taken
    """
    result = await db.execute(
        select(CallLog)
        .where(CallLog.id == call_log_id)
        .options(
            joinedload(CallLog.patient),
            joinedload(CallLog.plan)
            .joinedload(Plan.patient_condition)
            .joinedload(PatientCondition.chronic_condition),
        )
    )
    call = result.scalar_one()
    outbound = call.direction == DIRECTION_OUTBOUND

    call.transcript = transcript or call.transcript
    call.ended_at = call.ended_at or datetime.utcnow()
    if call.started_at:
        call.duration_seconds = int((call.ended_at - call.started_at).total_seconds())
    else:
        call.duration_seconds = duration_seconds
    call.recording_url = recording_url or call.recording_url
    call.status = "completed"

    # One summary schema for every call
    condition = (
        call.plan.patient_condition.chronic_condition.display_name if call.plan else "none"
    )
    patient_name = f"{call.patient.first_name} {call.patient.last_name}" if call.patient else None
    context_text = f"""Call direction: {call.direction} ({'the clinic phoned the patient for a check-in' if outbound else 'the caller phoned the clinic'})
Patient on record: {patient_name or 'none (unknown caller)'}
Chronic condition: {condition}
Call duration: {call.duration_seconds} seconds"""
    summary = await finalize_call_summary(transcript, context_text) if transcript.strip() else {}

    appointments = list(
        (await db.execute(select(Appointment).where(Appointment.call_log_id == call_log_id))).scalars().all()
    )
    call.structured_summary = summary or None
    call.summary = summary.get("summary")
    call.patient_name = (
        summary.get("patient_name") or patient_name or (appointments[0].patient_name if appointments else None)
    )
    call.reason = summary.get("reason") or (appointments[0].reason if appointments else None)
    call.urgency = summary.get("urgency")
    call.warning_signs_detected = bool(summary.get("warning_signs_detected"))
    call.medication_adherence_reported = summary.get("medication_adherence")
    call.csat_score = summary.get("csat_score")
    call.outcome = (
        "booked"
        if appointments
        else summary.get("outcome") or ("no_conversation" if not transcript.strip() else "completed")
    )

    actions = {
        "escalations_created": [],
        "appointments_created": [],
        "reschedule_date": None,
    }

    # Fill gaps on appointments booked during the call
    for appointment in appointments:
        if call.patient_name and appointment.patient_name in ("", "Unknown"):
            appointment.patient_name = call.patient_name
        if call.reason and not appointment.reason:
            appointment.reason = call.reason

    # Red flags or an urgent caller -> one escalation per call (the agent may already have raised one live)
    urgent = call.urgency in ("urgent", "emergency")
    already_escalated = (
        await db.execute(select(Escalation.id).where(Escalation.call_log_id == call_log_id).limit(1))
    ).scalar_one_or_none()
    if (call.warning_signs_detected or urgent) and not already_escalated:
        escalation = Escalation(
            call_log_id=call_log_id,
            patient_id=call.patient_id,
            reason=summary.get("warning_sign_details")
            or call.summary
            or call.reason
            or "Red flags detected during call",
            severity="urgent" if call.urgency == "emergency" else "high",
            status="open",
        )
        db.add(escalation)
        await db.flush()
        actions["escalations_created"].append(
            {
                "escalation_id": escalation.id,
                "reason": escalation.reason,
                "severity": escalation.severity,
            }
        )

    # Patient wants a visit but no slot was booked in the call -> staff-confirmed request
    if summary.get("appointment_requested") and not appointments and call.plan:
        physician_name = call.plan.assigned_physician_name
        # Link to the shared doctor table when the care plan's physician is one of our doctors
        doctor = await find_doctor_by_name(db, physician_name)
        appointment = Appointment(
            patient_id=call.patient_id,
            plan_id=call.plan_id,
            call_log_id=call_log_id,
            doctor_id=doctor.id if doctor else None,
            physician_name=physician_name,
            patient_name=patient_name or call.patient_name or "Unknown",
            phone_number=call.phone_number or (call.patient.phone_number if call.patient else None),
            source=SOURCE_AGENT,
            status="requested",
            reason=summary.get("appointment_details") or "Requested during call",
        )
        db.add(appointment)
        await db.flush()
        actions["appointments_created"].append(
            {
                "appointment_id": appointment.id,
                "reason": appointment.reason,
            }
        )

    # Reschedule care plan follow-up (only a check-in call counts as the outreach)
    if outbound and call.plan:
        next_due = datetime.utcnow() + timedelta(days=call.plan.followup_interval_days)
        call.plan.next_due_date = next_due
        call.plan.last_outreach_at = datetime.utcnow()
        actions["reschedule_date"] = next_due.isoformat()

    # Mark this call's schedule entry as completed
    if hasattr(call, "callback_schedule_id") and call.callback_schedule_id:
        schedule_result = await db.execute(
            select(CallbackSchedule).where(
                CallbackSchedule.id == call.callback_schedule_id
            )
        )
        schedule = schedule_result.scalar_one_or_none()
        if schedule:
            schedule.status = "completed"

    await db.commit()

    return actions


async def handle_failed_call(
    outreach_call_log_id: int,
    db: AsyncSession,
    reason: str,
    retry_backoff_minutes: int = 120,
) -> None:
    """Handle a failed call: update status, schedule retry, escalate if max retries exceeded.

    Args:
        outreach_call_log_id: ID of the outbound Call
        db: Database session
        reason: Reason for failure (no-answer, failed, etc.)
        retry_backoff_minutes: Minutes to wait before retrying
    """
    result = await db.execute(
        select(CallLog)
        .where(CallLog.id == outreach_call_log_id)
        .options(joinedload(CallLog.plan))
    )
    call = result.scalar_one()

    call.status = "failed"
    call.ended_at = datetime.utcnow()

    # Get or create retry schedule entry
    if call.plan:
        # Check if there's an active retry schedule
        schedule_result = await db.execute(
            select(CallbackSchedule)
            .where(CallbackSchedule.source_outreach_call_log_id == outreach_call_log_id)
            .where(CallbackSchedule.schedule_type == "retry")
        )
        schedule = schedule_result.scalar_one_or_none()

        if schedule:
            # Increment attempt and reschedule
            schedule.attempt_number += 1
            if schedule.attempt_number < schedule.max_attempts:
                schedule.scheduled_time = datetime.utcnow() + timedelta(
                    minutes=retry_backoff_minutes * (2 ** (schedule.attempt_number - 1))
                )
            else:
                # Max retries exceeded - escalate
                escalation = Escalation(
                    call_log_id=outreach_call_log_id,
                    patient_id=call.patient_id,
                    reason=f"Patient unreachable after {schedule.max_attempts} attempts. Last failure: {reason}",
                    severity="medium",
                    status="open",
                )
                db.add(escalation)
                schedule.status = "failed"
        else:
            # Create initial retry schedule
            schedule = CallbackSchedule(
                patient_id=call.patient_id,
                plan_id=call.plan_id,
                scheduled_time=datetime.utcnow() + timedelta(minutes=retry_backoff_minutes),
                schedule_type="retry",
                attempt_number=1,
                max_attempts=3,
                status="pending",
                source_outreach_call_log_id=outreach_call_log_id,
                notes=f"Retry after failed call: {reason}",
            )
            db.add(schedule)

    await db.commit()
