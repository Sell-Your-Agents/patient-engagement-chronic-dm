"""After every call: save the structured call record and make sure nothing the caller asked for is lost.

1. Close the call (times, duration, transcript) and extract the call record with Claude
   (caller, contact, language, intent, doctor, preferred slot, outcome, booking status, next action).
2. Create or update the caller's patient record (once a name is known) and link the call's rows to it.
3. Safety nets for what the agent may have missed during the call:
   - an appointment was asked for but no request was recorded -> pending appointment request
   - a callback was asked for but not recorded -> staff follow-up task
   - an emergency, or a request for a person that was not handled -> urgent / high follow-up
   - a question the agent could not answer -> "couldn't answer" follow-up
"""
import logging
import re
from datetime import datetime
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.appointment import STATUS_CONFIRMED, Appointment
from app.models.call_log import CallLog
from app.models.callback_schedule import (
    KIND_CALLBACK,
    KIND_DISTRESS,
    KIND_EMERGENCY,
    KIND_HUMAN,
    KIND_UNANSWERED,
    TRANSFER_ANSWERED,
    TRANSFER_NOT_ANSWERED,
    FollowUp,
)
from app.models.patient import LANGUAGES, Patient
from app.services.agent.claude_service import finalize_call_summary
from app.services.agent.context_shared import last_ten_digits, lookup_caller
from app.services.scheduling.appointment_service import record_appointment_request
from app.services.scheduling.callback_service import create_follow_up, pending_callback_for_call
from app.services.scheduling.clinic_scheduling import clinic_now

logger = logging.getLogger(__name__)

NOT_A_NAME = {"unknown", "caller", "patient", "none", "null", "", "unclear", "unconfirmed", "not given", "not provided", "n/a", "na"}


def _clean_name(value: Optional[str]) -> Optional[str]:
    if not value or value.strip().lower() in NOT_A_NAME:
        return None
    return value.strip()[:120]


def _contact(summary: dict, call: CallLog) -> Optional[str]:
    """The number the caller gave, else the number they called from."""
    given = re.sub(r"\D", "", str(summary.get("contact_number") or ""))
    if len(given) >= 10:
        return f"+91{given}" if len(given) == 10 else f"+{given}"
    return call.phone_number


async def _upsert_patient(
    db: AsyncSession, call: CallLog, name: Optional[str], phone: Optional[str], chosen_language: Optional[str]
) -> Optional[Patient]:
    """The caller's patient record: found by number, created once they have given a name."""
    patient = await db.get(Patient, call.patient_id) if call.patient_id else None
    if patient is None and phone:
        patient = await lookup_caller(db, phone)
    if patient is None and name and phone and len(last_ten_digits(phone)) == 10:
        patient = Patient(name=name, phone_number=phone)
        db.add(patient)
        await db.flush()
        logger.info(f"Patient #{patient.id} created from call #{call.id}")
    if patient is not None:
        if name and patient.name in ("", "Unknown"):
            patient.name = name
        # Only a language used on the call (chosen by the caller, or the saved one kept), never a guess
        if chosen_language in LANGUAGES:
            patient.preferred_language = chosen_language
    return patient


async def finalize_call(call_log_id: int, db: AsyncSession, transcript: str, duration_seconds: int) -> dict:
    call = await db.get(CallLog, call_log_id)
    call.transcript = transcript or call.transcript
    call.ended_at = call.ended_at or datetime.utcnow()
    call.duration_seconds = (
        int((call.ended_at - call.started_at).total_seconds()) if call.started_at else duration_seconds
    )
    if call.status != "transferred":
        call.status = "completed"

    spoke = "USER:" in (transcript or "")
    context_text = (
        f"Caller's phone number: {call.phone_number or 'not available'}\n"
        f"Language chosen during the call: {call.language or 'not chosen'}\n"
        f"Call was transferred to clinic staff: {'yes' if call.status == 'transferred' else 'no'}\n"
        f"Call duration: {call.duration_seconds} seconds\n"
        f"Current clinic date/time: {clinic_now().strftime('%A %Y-%m-%d %H:%M')}"
    )
    summary = await finalize_call_summary(transcript, context_text) if spoke else {}

    appointments = list(
        (await db.execute(
            select(Appointment).options(selectinload(Appointment.doctor)).where(Appointment.call_log_id == call_log_id)
        )).scalars().all()
    )
    callback = await pending_callback_for_call(db, call_log_id)
    tasks = list((await db.execute(select(FollowUp).where(FollowUp.call_log_id == call_log_id))).scalars().all())
    kinds = {t.kind for t in tasks}
    human = next((t for t in tasks if t.kind == KIND_HUMAN), None)

    # ---- The call record ----
    call.structured_summary = summary or None
    call.summary = summary.get("summary") or (None if spoke else "The caller did not speak.")
    name = _clean_name(summary.get("caller_name")) or (appointments[0].patient_name if appointments else None)
    name = _clean_name(name) or call.patient_name
    call.patient_name = name
    chosen_language = call.language  # set during the call by SET_LANGUAGE or the saved-language greeting
    if summary.get("language") in LANGUAGES and not call.language:
        call.language = summary["language"]
    call.intent = summary.get("intent") or ("other" if not spoke else None)
    call.reason = summary.get("reason") or (appointments[0].reason if appointments else None)
    call.urgency = summary.get("urgency")
    call.doctor_requested = summary.get("doctor_requested") or (appointments[0].doctor_display_name if appointments else None)
    call.preferred_slot = summary.get("preferred_slot") or (appointments[0].preferred_time if appointments else None)
    call.outcome = summary.get("outcome") or ("No conversation" if not spoke else None)

    contact = _contact(summary, call)
    patient = await _upsert_patient(db, call, name, contact, chosen_language)
    if patient is not None:
        call.patient_id = patient.id
        for model in (Appointment, FollowUp):
            await db.execute(
                update(model).where(model.call_log_id == call_log_id, model.patient_id.is_(None)).values(patient_id=patient.id)
            )

    # ---- Safety nets ----
    if summary.get("appointment_requested") and not appointments:
        outcome = await record_appointment_request(
            db,
            patient_name=name or "Unknown",
            phone_number=contact,
            doctor_requested=summary.get("doctor_requested"),
            preferred_time=summary.get("preferred_slot"),
            reason=summary.get("reason"),
            call_log_id=call_log_id,
            patient_id=call.patient_id,
        )
        appointments.append(outcome.appointment)
        logger.info(f"Call #{call_log_id}: appointment request #{outcome.appointment.id} added after the call")

    # One callback is enough: skip it when an appointment request or a staff follow-up already covers the call
    if summary.get("callback_requested") and not callback and not appointments and not kinds & {KIND_HUMAN, KIND_UNANSWERED}:
        callback = await create_follow_up(
            db,
            kind=KIND_CALLBACK,
            call_log_id=call_log_id,
            patient_id=call.patient_id,
            patient_name=name,
            phone_number=contact,
            doctor_requested=summary.get("doctor_requested"),
            preferred_time=summary.get("preferred_slot"),
            reason=summary.get("callback_reason") or summary.get("reason"),
        )
        tasks.append(callback)

    async def add(kind: str, reason: str, priority=None) -> FollowUp:
        task = await create_follow_up(
            db, kind=kind, priority=priority, call_log_id=call_log_id, patient_id=call.patient_id,
            patient_name=name, phone_number=contact, reason=reason,
        )
        tasks.append(task)
        kinds.add(kind)
        logger.info(f"Call #{call_log_id}: follow-up #{task.id} ({kind}) added after the call")
        return task

    emergency = call.urgency == "emergency"
    if emergency and not kinds & {KIND_EMERGENCY, KIND_DISTRESS}:
        await add(KIND_EMERGENCY, summary.get("summary") or "Possible emergency described during the call")
    if summary.get("human_assistance_requested") and human is None and call.status != "transferred":
        human = await add(KIND_HUMAN, summary.get("reason") or "Wants to talk to clinic staff", "urgent" if call.urgency == "urgent" else None)
    if KIND_UNANSWERED not in kinds:
        for question in (summary.get("unanswered_questions") or [])[:3]:
            if isinstance(question, str) and question.strip():
                await add(KIND_UNANSWERED, question.strip())
    for task in tasks:
        task.patient_name = task.patient_name or name
        task.patient_id = task.patient_id or call.patient_id
        task.phone_number = task.phone_number or contact

    # ---- Booking status and next action, from what was actually recorded ----
    transfer = human.transfer_status if human else None
    if transfer == TRANSFER_ANSWERED:
        call.status = "transferred"
    if appointments:
        confirmed = all(a.status == STATUS_CONFIRMED for a in appointments)
        call.booking_status = "confirmed" if confirmed else "pending"
        call.outcome = call.outcome or "Appointment request captured"
        call.next_action = "None" if confirmed else "Clinic staff callback to confirm appointment"
    else:
        call.booking_status = "not_applicable"
        if transfer == TRANSFER_ANSWERED:
            call.next_action = "Handled by clinic staff (transferred)"
        elif emergency:
            call.next_action = "Urgent: check on caller"
        elif transfer == TRANSFER_NOT_ANSWERED or any(t.status == "pending" for t in tasks):
            call.next_action = "Clinic staff to call back"
        elif call.status == "transferred":
            call.next_action = "Transferring to clinic staff"
        else:
            call.next_action = summary.get("next_action") or "None"

    # Fill gaps on rows created during the call
    for appointment in appointments:
        if name and appointment.patient_name in ("", "Unknown"):
            appointment.patient_name = name
        if call.reason and not appointment.reason:
            appointment.reason = call.reason
    if callback and not callback.patient_name:
        callback.patient_name = name

    await db.commit()
    return {
        "call_id": call.id,
        "intent": call.intent,
        "booking_status": call.booking_status,
        "next_action": call.next_action,
    }
