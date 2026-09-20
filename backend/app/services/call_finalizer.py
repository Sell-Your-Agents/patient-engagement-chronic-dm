import json
import re
from datetime import datetime, timedelta
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.outreach_call import OutreachCall
from app.models.care_plan import CarePlan
from app.models.escalation_case import EscalationCase
from app.models.appointment import Appointment
from app.models.next_outreach_schedule import NextOutreachSchedule
from app.services.claude_service import finalize_call_summary


async def finalize_call(
    outreach_call_id: int,
    db: AsyncSession,
    transcript: str,
    duration_seconds: int,
    recording_url: Optional[str] = None,
) -> dict:
    """Finalize a call: extract structured data, handle escalations, reschedule follow-up.

    Args:
        outreach_call_id: ID of the OutreachCall to finalize
        db: Database session
        transcript: Full conversation transcript
        duration_seconds: Call duration
        recording_url: Optional URL to call recording

    Returns:
        Summary dict with action items taken
    """

    result = await db.execute(
        select(OutreachCall)
        .where(OutreachCall.id == outreach_call_id)
        .options(__import__("sqlalchemy.orm", fromlist=["joinedload"]).joinedload(OutreachCall.care_plan))
    )
    call = result.scalar_one()

    # Extract structured summary from transcript
    system_context = f"""
Patient: {call.patient.first_name} {call.patient.last_name}
Condition: {call.care_plan.patient_condition.chronic_condition.display_name if call.care_plan else 'Unknown'}
Call Duration: {duration_seconds} seconds
"""

    summary = await finalize_call_summary(transcript, system_context)

    # Update OutreachCall with results
    call.transcript = transcript
    call.structured_summary = summary
    call.status = "completed"
    call.ended_at = datetime.utcnow()
    call.duration_seconds = duration_seconds
    call.recording_url = recording_url
    call.warning_signs_detected = summary.get("warning_signs_detected", False)
    call.medication_adherence_reported = summary.get("medication_adherence", "unknown")
    call.csat_score = summary.get("csat_score")

    actions = {
        "escalations_created": [],
        "appointments_created": [],
        "reschedule_date": None,
    }

    # Handle warning signs - create escalation
    if summary.get("warning_signs_detected"):
        escalation = EscalationCase(
            outreach_call_id=outreach_call_id,
            patient_id=call.patient_id,
            reason=summary.get("warning_sign_details", "Red flags detected during call"),
            severity="high",
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

    # Handle appointment request
    if summary.get("appointment_requested") and call.care_plan:
        appointment = Appointment(
            patient_id=call.patient_id,
            care_plan_id=call.care_plan_id,
            triggering_outreach_call_id=outreach_call_id,
            physician_name=call.care_plan.assigned_physician_name,
            status="requested",
            reason=summary.get("appointment_details", "Requested during outreach call"),
        )
        db.add(appointment)
        await db.flush()
        actions["appointments_created"].append(
            {
                "appointment_id": appointment.id,
                "reason": appointment.reason,
            }
        )

    # Reschedule care plan follow-up
    if call.care_plan:
        # Set next due date based on follow-up interval
        next_due = datetime.utcnow() + timedelta(
            days=call.care_plan.followup_interval_days
        )
        call.care_plan.next_due_date = next_due
        call.care_plan.last_outreach_at = datetime.utcnow()
        actions["reschedule_date"] = next_due.isoformat()

    # Mark this call's schedule entry as completed
    if hasattr(call, "next_outreach_schedule_id") and call.next_outreach_schedule_id:
        schedule_result = await db.execute(
            select(NextOutreachSchedule).where(
                NextOutreachSchedule.id == call.next_outreach_schedule_id
            )
        )
        schedule = schedule_result.scalar_one_or_none()
        if schedule:
            schedule.status = "completed"

    await db.commit()

    return actions


async def handle_failed_call(
    outreach_call_id: int,
    db: AsyncSession,
    reason: str,
    retry_backoff_minutes: int = 120,
) -> None:
    """Handle a failed call: update status, schedule retry, escalate if max retries exceeded.

    Args:
        outreach_call_id: ID of the OutreachCall
        db: Database session
        reason: Reason for failure (no-answer, failed, etc.)
        retry_backoff_minutes: Minutes to wait before retrying
    """
    result = await db.execute(
        select(OutreachCall).where(OutreachCall.id == outreach_call_id)
    )
    call = result.scalar_one()

    call.status = "failed"
    call.ended_at = datetime.utcnow()

    # Get or create retry schedule entry
    if call.care_plan:
        # Check if there's an active retry schedule
        schedule_result = await db.execute(
            select(NextOutreachSchedule)
            .where(NextOutreachSchedule.outreach_call_id == outreach_call_id)
            .where(NextOutreachSchedule.schedule_type == "retry")
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
                escalation = EscalationCase(
                    outreach_call_id=outreach_call_id,
                    patient_id=call.patient_id,
                    reason=f"Patient unreachable after {schedule.max_attempts} attempts. Last failure: {reason}",
                    severity="medium",
                    status="open",
                )
                db.add(escalation)
                schedule.status = "failed"
        else:
            # Create initial retry schedule
            schedule = NextOutreachSchedule(
                patient_id=call.patient_id,
                care_plan_id=call.care_plan_id,
                scheduled_time=datetime.utcnow() + timedelta(minutes=retry_backoff_minutes),
                schedule_type="retry",
                attempt_number=1,
                max_attempts=3,
                status="pending",
                source_outreach_call_id=outreach_call_id,
                notes=f"Retry after failed call: {reason}",
            )
            db.add(schedule)

    await db.commit()
