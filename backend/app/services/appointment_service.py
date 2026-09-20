from datetime import datetime, timedelta
from typing import List, Optional, Dict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.appointment import Appointment
from app.models.patient import Patient


class AppointmentService:
    """Service for managing appointments - currently mock, easily swappable."""

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
        care_plan_id: Optional[int],
        physician_name: str,
        scheduled_at: datetime,
        db: AsyncSession,
    ) -> Appointment:
        """Book an appointment (creates Appointment record)."""
        appointment = Appointment(
            patient_id=patient_id,
            care_plan_id=care_plan_id,
            physician_name=physician_name,
            scheduled_at=scheduled_at,
            duration_minutes=30,
            status="requested",
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
