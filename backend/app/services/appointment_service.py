from datetime import datetime, timedelta
from typing import List, Optional, Dict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.appointment import Appointment, SOURCE_AGENT
from app.models.patient import Patient
from app.services.clinic_scheduling import book_slot, find_doctor_by_name, get_free_slots


class AppointmentService:
    """Staff-side appointment requests.

    Uses the same doctors and the same appointment book as the phone agent's live bookings, so
    neither can double-book the other. Physicians we have no schedule for fall back to mock slots.
    """

    @staticmethod
    async def get_availability(
        db: AsyncSession,
        physician_name: str,
        days_ahead: int = 14,
    ) -> List[Dict]:
        """Real free slots when the physician is one of our doctors, mock slots otherwise."""
        doctor = await find_doctor_by_name(db, physician_name)
        if not doctor:
            return await AppointmentService.get_mock_availability(physician_name, days_ahead)
        free = await get_free_slots(db, [doctor], days_ahead)
        return [
            {
                "datetime": slot.isoformat(),
                "duration_minutes": doctor.slot_minutes,
                "physician_name": doctor.name,
                "available": True,
            }
            for slot in free[doctor.id]
        ]

    @staticmethod
    async def get_mock_availability(
        physician_name: str,
        days_ahead: int = 14,
    ) -> List[Dict]:
        """Get mock appointment availability (hardcoded slots for MVP).

        In production, this would query a real EMR/scheduling system.
        """
        availability = []
        start_date = datetime.utcnow().date()

        # Generate weekday slots for next N days
        for day_offset in range(days_ahead):
            current_date = start_date + timedelta(days=day_offset)

            # Skip weekends
            if current_date.weekday() >= 5:
                continue

            # Morning slots (9 AM, 10 AM, 11 AM)
            for hour in [9, 10, 11]:
                slot_time = datetime.combine(current_date, datetime.min.time().replace(hour=hour))
                availability.append(
                    {
                        "datetime": slot_time.isoformat(),
                        "duration_minutes": 30,
                        "physician_name": physician_name,
                        "available": True,
                    }
                )

            # Afternoon slots (2 PM, 3 PM, 4 PM)
            for hour in [14, 15, 16]:
                slot_time = datetime.combine(current_date, datetime.min.time().replace(hour=hour))
                availability.append(
                    {
                        "datetime": slot_time.isoformat(),
                        "duration_minutes": 30,
                        "physician_name": physician_name,
                        "available": True,
                    }
                )

        # Simulate some booked slots (hardcoded for MVP)
        booked_indices = [0, 5, 12, 18]  # Some slots are "booked"
        for idx in booked_indices:
            if idx < len(availability):
                availability[idx]["available"] = False

        return availability

    @staticmethod
    async def book_appointment(
        patient_id: int,
        plan_id: Optional[int],
        physician_name: str,
        scheduled_at: datetime,
        db: AsyncSession,
    ) -> Appointment:
        """Request an appointment for a patient (staff confirm it afterwards).

        If the physician is one of our doctors the slot is validated and held in their schedule
        (raises BookingError if it is not free). Otherwise it is stored against the free-text name.
        """
        patient = await db.get(Patient, patient_id)
        patient_name = f"{patient.first_name} {patient.last_name}" if patient else "Unknown"
        phone_number = patient.phone_number if patient else None

        doctor = await find_doctor_by_name(db, physician_name)
        if doctor:
            return await book_slot(
                db,
                doctor_id=doctor.id,
                start_at=scheduled_at,
                patient_name=patient_name,
                phone_number=phone_number,
                reason="Scheduled during outreach call",
                source=SOURCE_AGENT,
                patient_id=patient_id,
                plan_id=plan_id,
                status="requested",
            )

        appointment = Appointment(
            patient_id=patient_id,
            plan_id=plan_id,
            physician_name=physician_name,
            patient_name=patient_name,
            phone_number=phone_number,
            start_at=scheduled_at,
            end_at=scheduled_at + timedelta(minutes=30),
            status="requested",
            source=SOURCE_AGENT,
            reason="Scheduled during outreach call",
        )
        db.add(appointment)
        await db.flush()
        return appointment

    @staticmethod
    async def confirm_appointment(
        appointment_id: int,
        confirmed_by_user_id: int,
        db: AsyncSession,
    ) -> Appointment:
        """Confirm an appointment (care team action)."""
        result = await db.execute(
            select(Appointment).where(Appointment.id == appointment_id)
        )
        appointment = result.scalar_one_or_none()

        if not appointment:
            raise ValueError(f"Appointment {appointment_id} not found")

        appointment.status = "confirmed"
        appointment.confirmed_by_user_id = confirmed_by_user_id
        await db.flush()
        return appointment

    @staticmethod
    async def cancel_appointment(
        appointment_id: int,
        db: AsyncSession,
    ) -> Appointment:
        """Cancel an appointment."""
        result = await db.execute(
            select(Appointment).where(Appointment.id == appointment_id)
        )
        appointment = result.scalar_one_or_none()

        if not appointment:
            raise ValueError(f"Appointment {appointment_id} not found")

        appointment.status = "cancelled"
        await db.flush()
        return appointment
