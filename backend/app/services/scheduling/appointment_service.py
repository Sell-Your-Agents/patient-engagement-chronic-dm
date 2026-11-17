"""Recording appointment requests, and the integration layer for clinic appointment systems.

The agent must never say an appointment is booked unless a clinic system confirms it. So:
  - With no integration (APPOINTMENT_INTEGRATION=none, the default) every request is stored in our
    database as "pending" and a follow-up task asks staff to confirm it with the caller.
  - When a clinic MIS / CRM / appointment API is connected, add a provider below whose book()
    returns confirmed=True only after the clinic system reports a successful booking.
"""
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.appointment import (
    SOURCE_AGENT,
    STATUS_CONFIRMED,
    STATUS_PENDING,
    Appointment,
)
from app.models.doctor import Doctor
from app.models.callback_schedule import KIND_CONFIRM_APPOINTMENT, FollowUp
from app.services.scheduling.callback_service import create_follow_up
from app.services.scheduling.clinic_scheduling import BookingError, check_slot, find_doctor

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
    # Set when the requested slot could not be used (the request is still recorded, without it)
    slot_problem: Optional[str] = None


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
    """Store an appointment request, try the clinic system, and queue a staff follow-up if pending."""
    doctor = await db.get(Doctor, doctor_id) if doctor_id else None
    if doctor is None and doctor_requested:
        doctor = await find_doctor(db, doctor_requested)

    slot_problem = None
    start_at = None
    if slot is not None and doctor is not None:
        try:
            start_at = await check_slot(db, doctor, slot)
        except BookingError as err:
            slot_problem = str(err)

    appointment = Appointment(
        call_log_id=call_log_id,
        patient_id=patient_id,
        doctor=doctor,
        doctor_requested=doctor_requested or (doctor.specialty if doctor else None),
        patient_name=(patient_name or "").strip() or "Unknown",
        phone_number=phone_number,
        reason=reason,
        preferred_time=preferred_time or (start_at.strftime("%a %d %b, %I:%M %p") if start_at else None),
        start_at=start_at,
        end_at=start_at + timedelta(minutes=doctor.slot_minutes) if start_at and doctor else None,
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

    slot_problem = None
    start_at = None
    if slot is not None and doctor is not None:
        try:
            start_at = await check_slot(db, doctor, slot, ignore_appointment_id=appointment.id)
        except BookingError as err:
            slot_problem = str(err)

    appointment.patient_name = (patient_name or "").strip() or appointment.patient_name
    appointment.phone_number = phone_number or appointment.phone_number
    appointment.doctor = doctor
    appointment.doctor_requested = doctor_requested or (doctor.specialty if doctor else appointment.doctor_requested)
    appointment.reason = reason or appointment.reason
    appointment.start_at = start_at
    appointment.end_at = start_at + timedelta(minutes=doctor.slot_minutes) if start_at and doctor else None
    appointment.preferred_time = preferred_time or (start_at.strftime("%a %d %b, %I:%M %p") if start_at else appointment.preferred_time)

    result = await db.execute(select(FollowUp).where(FollowUp.appointment_id == appointment.id))
    for task in result.scalars().all():
        task.patient_name = appointment.patient_name
        task.phone_number = appointment.phone_number
        task.doctor_requested = doctor.name if doctor else appointment.doctor_requested
        task.preferred_time = appointment.preferred_time
    await db.flush()
    return RequestOutcome(appointment=appointment, confirmed=appointment.status == STATUS_CONFIRMED, slot_problem=slot_problem)
