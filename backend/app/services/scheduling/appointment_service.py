"""Recording appointment requests, patients' changes to them, and the clinic-system integration layer.

The agent must never say an appointment is booked unless a clinic system confirms it. So:
  - With no integration (APPOINTMENT_INTEGRATION=none, the default) every request is stored in our
    database as "pending" and a follow-up task asks staff to confirm it with the caller.
  - When a clinic MIS / CRM / appointment API is connected, add a provider below whose book()
    returns confirmed=True only after the clinic system reports a successful booking.

There are no fixed slots: a visit is a day plus a rough arrival time within the doctor's working
hours (see clinic_scheduling.py).

A patient calling again from the number they booked with can (call_agent.py):
  - move the visit (reschedule_appointment): done straight away; staff get a "rescheduled" follow-up
  - ask to cancel it (request_cancellation): status "cancel_requested"; staff confirm the cancellation
"""
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.appointment import (
    SOURCE_AGENT,
    STATUS_CANCEL_REQUESTED,
    STATUS_CONFIRMED,
    STATUS_PENDING,
    Appointment,
)
from app.models.callback_schedule import (
    FOLLOWUP_PENDING,
    KIND_CANCEL_REQUEST,
    KIND_CONFIRM_APPOINTMENT,
    KIND_RESCHEDULED,
    FollowUp,
)
from app.models.doctor import Doctor
from app.services.scheduling.callback_service import create_follow_up
from app.services.scheduling.clinic_scheduling import BookingError, check_visit, find_doctor, visit_text

logger = logging.getLogger(__name__)
settings = get_settings()


@dataclass
class ProviderResult:
    confirmed: bool
    external_ref: Optional[str] = None
    message: Optional[str] = None


class AppointmentProvider:
    """A clinic appointment system. book() is called for every request the agent records."""

    name = "none"

    async def book(self, appointment: Appointment, doctor: Optional[Doctor]) -> ProviderResult:
        raise NotImplementedError


class NoIntegrationProvider(AppointmentProvider):
    """No clinic system connected: nothing is booked, staff confirm every request."""

    name = "none"

    async def book(self, appointment: Appointment, doctor: Optional[Doctor]) -> ProviderResult:
        return ProviderResult(confirmed=False, message="No clinic appointment system connected")


def get_provider() -> AppointmentProvider:
    integration = (settings.appointment_integration or "none").strip().lower()
    if integration != "none":
        logger.warning(f"Unknown APPOINTMENT_INTEGRATION '{integration}'; storing requests as pending")
    return NoIntegrationProvider()


@dataclass
class RequestOutcome:
    appointment: Appointment
    confirmed: bool
    # Set when the requested visit time could not be used (the request is still recorded, without it)
    slot_problem: Optional[str] = None


async def _visit(doctor: Optional[Doctor], when: Optional[datetime]):
    """(start_at, problem): the visit time if the doctor works then, else the reason it can't be used."""
    if when is None or doctor is None:
        return None, None
    try:
        return check_visit(doctor, when), None
    except BookingError as err:
        return None, str(err)


async def record_appointment_request(
    db: AsyncSession,
    *,
    patient_name: str,
    phone_number: Optional[str],
    doctor_requested: Optional[str],
    doctor_id: Optional[int] = None,
    preferred_time: Optional[str] = None,
    slot: Optional[datetime] = None,
    reason: Optional[str] = None,
    call_log_id: Optional[int] = None,
    patient_id: Optional[int] = None,
    source: str = SOURCE_AGENT,
) -> RequestOutcome:
    """Store an appointment request, try the clinic system, and queue a staff follow-up if pending.

    slot: the visit day and rough time (any time within the doctor's working hours).
    """
    doctor = await db.get(Doctor, doctor_id) if doctor_id else None
    if doctor is None and doctor_requested:
        doctor = await find_doctor(db, doctor_requested)
    start_at, slot_problem = await _visit(doctor, slot)

    appointment = Appointment(
        call_log_id=call_log_id,
        patient_id=patient_id,
        doctor=doctor,
        doctor_requested=doctor_requested or (doctor.specialty if doctor else None),
        patient_name=(patient_name or "").strip() or "Unknown",
        phone_number=phone_number,
        reason=reason,
        preferred_time=preferred_time or (visit_text(start_at) if start_at else None),
        start_at=start_at,
        end_at=None,
        status=STATUS_PENDING,
        source=source,
    )
    db.add(appointment)
    await db.flush()

    result = await get_provider().book(appointment, doctor)
    if result.confirmed:
        appointment.status = STATUS_CONFIRMED
        appointment.external_ref = result.external_ref
        appointment.confirmed_at = datetime.utcnow()
    else:
        await create_follow_up(
            db,
            kind=KIND_CONFIRM_APPOINTMENT,
            call_log_id=call_log_id,
            appointment_id=appointment.id,
            patient_id=patient_id,
            patient_name=appointment.patient_name,
            phone_number=phone_number,
            doctor_requested=doctor.name if doctor else appointment.doctor_requested,
            preferred_time=appointment.preferred_time,
            reason=f"Confirm appointment request{': ' + reason if reason else ''}",
        )
    return RequestOutcome(appointment=appointment, confirmed=result.confirmed, slot_problem=slot_problem)


async def _sync_follow_ups(db: AsyncSession, appointment: Appointment, doctor: Optional[Doctor]) -> None:
    """Keep the appointment's open follow-ups showing its current details."""
    result = await db.execute(
        select(FollowUp).where(FollowUp.appointment_id == appointment.id, FollowUp.status == FOLLOWUP_PENDING)
    )
    for task in result.scalars().all():
        task.patient_name = appointment.patient_name
        task.phone_number = appointment.phone_number
        task.doctor_requested = doctor.name if doctor else appointment.doctor_requested
        task.preferred_time = appointment.preferred_time


async def update_appointment_request(
    db: AsyncSession,
    appointment: Appointment,
    *,
    patient_name: str,
    phone_number: Optional[str],
    doctor_requested: Optional[str],
    doctor_id: Optional[int] = None,
    preferred_time: Optional[str] = None,
    slot: Optional[datetime] = None,
    reason: Optional[str] = None,
) -> RequestOutcome:
    """The caller changed a request made earlier in the same call: update it (and its follow-up) in place."""
    doctor = await db.get(Doctor, doctor_id) if doctor_id else None
    if doctor is None and doctor_requested:
        doctor = await find_doctor(db, doctor_requested)
    if doctor is None and appointment.doctor_id and not doctor_requested:
        doctor = await db.get(Doctor, appointment.doctor_id)
    start_at, slot_problem = await _visit(doctor, slot)

    appointment.patient_name = (patient_name or "").strip() or appointment.patient_name
    appointment.phone_number = phone_number or appointment.phone_number
    appointment.doctor = doctor
    appointment.doctor_requested = doctor_requested or (doctor.specialty if doctor else appointment.doctor_requested)
    appointment.reason = reason or appointment.reason
    appointment.start_at = start_at
    appointment.end_at = None
    appointment.preferred_time = preferred_time or (visit_text(start_at) if start_at else appointment.preferred_time)

    await _sync_follow_ups(db, appointment, doctor)
    await db.flush()
    return RequestOutcome(appointment=appointment, confirmed=appointment.status == STATUS_CONFIRMED, slot_problem=slot_problem)


def appointment_when(appointment: Appointment) -> str:
    """'Fri 21 Nov, around 2 PM', or the caller's words when no day was set."""
    if appointment.start_at:
        return visit_text(appointment.start_at)
    return appointment.preferred_time or "time not set"


async def reschedule_appointment(
    db: AsyncSession,
    appointment: Appointment,
    *,
    when: Optional[datetime],
    preferred_time: Optional[str],
    call_log_id: Optional[int],
) -> Optional[str]:
    """The patient moved their visit (from the number they booked with). Returns a problem, or None if done.

    The new day and time are saved straight away (status unchanged); staff get a follow-up telling
    them what changed.
    """
    doctor = await db.get(Doctor, appointment.doctor_id) if appointment.doctor_id else None
    if when is None:
        return "no new day was given"
    if doctor is not None:
        try:
            when = check_visit(doctor, when)
        except BookingError as err:
            return str(err)
    before = appointment_when(appointment)
    appointment.start_at = when.replace(second=0, microsecond=0)
    appointment.end_at = None
    appointment.preferred_time = preferred_time or visit_text(appointment.start_at)
    if appointment.status == STATUS_CANCEL_REQUESTED:
        # Moving it means they want to keep it after all
        appointment.status = STATUS_CONFIRMED if appointment.confirmed_at else STATUS_PENDING
    now_text = appointment_when(appointment)
    appointment.change_note = f"Moved by patient: was {before}"[:300]
    await _sync_follow_ups(db, appointment, doctor)
    await create_follow_up(
        db,
        kind=KIND_RESCHEDULED,
        call_log_id=call_log_id,
        appointment_id=appointment.id,
        patient_id=appointment.patient_id,
        patient_name=appointment.patient_name,
        phone_number=appointment.phone_number,
        doctor_requested=doctor.name if doctor else appointment.doctor_requested,
        preferred_time=now_text,
        reason=f"Patient moved appointment #{appointment.id} from {before} to {now_text}",
    )
    await db.flush()
    return None


async def request_cancellation(
    db: AsyncSession, appointment: Appointment, *, reason: Optional[str], call_log_id: Optional[int]
) -> None:
    """The patient asked to cancel (from the number they booked with): staff confirm the cancellation."""
    if appointment.status == STATUS_CANCEL_REQUESTED:
        return
    appointment.status = STATUS_CANCEL_REQUESTED
    appointment.change_note = "Patient asked to cancel" + (f": {reason}" if reason else "")
    appointment.change_note = appointment.change_note[:300]
    doctor_name = appointment.doctor.name if appointment.doctor else (appointment.doctor_requested or "the doctor")
    await create_follow_up(
        db,
        kind=KIND_CANCEL_REQUEST,
        call_log_id=call_log_id,
        appointment_id=appointment.id,
        patient_id=appointment.patient_id,
        patient_name=appointment.patient_name,
        phone_number=appointment.phone_number,
        doctor_requested=doctor_name,
        preferred_time=appointment_when(appointment),
        reason=(
            f"{appointment.patient_name} wants to cancel the appointment with {doctor_name} on "
            f"{appointment_when(appointment)}" + (f" (reason: {reason})" if reason else "") + ". Confirm the cancellation."
        ),
    )
    await db.flush()
