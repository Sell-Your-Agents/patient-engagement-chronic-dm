from fastapi import APIRouter, Depends, Query
from typing import Dict, List
from datetime import datetime, timedelta
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
import logging

from app.database import get_db
from app.deps import get_current_user
from app.models.care_team_user import CareTeamUser
from app.models.outreach_call import OutreachCall
from app.models.patient import Patient
from app.models.appointment import Appointment
from app.models.escalation_case import EscalationCase

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/kpis", response_model=Dict)
async def get_kpis(
    db: AsyncSession = Depends(get_db),
    _: CareTeamUser = Depends(get_current_user),
) -> Dict:
    """Get key performance indicators for the program."""
    logger.info("GET /api/analytics/kpis called")

    try:
        # Total patients enrolled
        logger.debug("Fetching total patients...")
        total_patients_result = await db.execute(select(func.count(Patient.id)))
        total_patients = total_patients_result.scalar() or 0
        logger.debug(f"Total patients: {total_patients}")

        # Active patients (status=active, has consent)
        logger.debug("Fetching active patients...")
        active_patients_result = await db.execute(
            select(func.count(Patient.id)).where(
                Patient.status == "active",
                Patient.communication_consent == True,
            )
        )
        active_patients = active_patients_result.scalar() or 0
        logger.debug(f"Active patients: {active_patients}")

        # Total outreach calls
        logger.debug("Fetching total calls...")
        total_calls_result = await db.execute(select(func.count(OutreachCall.id)))
        total_calls = total_calls_result.scalar() or 0
        logger.debug(f"Total calls: {total_calls}")

        # Completed calls
        logger.debug("Fetching completed calls...")
        completed_calls_result = await db.execute(
            select(func.count(OutreachCall.id)).where(OutreachCall.status == "completed")
        )
        completed_calls = completed_calls_result.scalar() or 0
        logger.debug(f"Completed calls: {completed_calls}")

        # Call completion rate
        call_completion_rate = (
            (completed_calls / total_calls * 100) if total_calls > 0 else 0
        )

        # Calls with warning signs detected
        logger.debug("Fetching warning calls...")
        warning_calls_result = await db.execute(
            select(func.count(OutreachCall.id)).where(
                OutreachCall.warning_signs_detected == True
            )
        )
        warning_calls = warning_calls_result.scalar() or 0
        logger.debug(f"Warning calls: {warning_calls}")

        # Average CSAT (patient satisfaction)
        logger.debug("Fetching average CSAT...")
        avg_csat_result = await db.execute(
            select(func.avg(OutreachCall.csat_score)).where(
                OutreachCall.csat_score.isnot(None)
            )
        )
        avg_csat = avg_csat_result.scalar() or 0
        logger.debug(f"Average CSAT: {avg_csat}")

        # Medication adherence (calls reporting good adherence)
        logger.debug("Fetching adherence calls...")
        adherence_calls_result = await db.execute(
            select(func.count(OutreachCall.id)).where(
                OutreachCall.medication_adherence_reported.in_(["good", "excellent"])
            )
        )
        adherence_calls = adherence_calls_result.scalar() or 0
        logger.debug(f"Adherence calls: {adherence_calls}")

        # Appointment compliance (confirmed appointments)
        logger.debug("Fetching confirmed appointments...")
        confirmed_appointments_result = await db.execute(
            select(func.count(Appointment.id)).where(
                Appointment.status.in_(["confirmed", "completed"])
            )
        )
        confirmed_appointments = confirmed_appointments_result.scalar() or 0
        logger.debug(f"Confirmed appointments: {confirmed_appointments}")

        # Escalation cases (open)
        logger.debug("Fetching open escalations...")
        open_escalations_result = await db.execute(
            select(func.count(EscalationCase.id)).where(
                EscalationCase.status == "open"
            )
        )
        open_escalations = open_escalations_result.scalar() or 0
        logger.debug(f"Open escalations: {open_escalations}")

        kpis = {
            "total_patients_enrolled": total_patients,
            "active_patients": active_patients,
            "engagement_rate": round(
                (active_patients / total_patients * 100) if total_patients > 0 else 0, 2
            ),
            "total_outreach_calls": total_calls,
            "completed_calls": completed_calls,
            "call_completion_rate": round(call_completion_rate, 2),
            "calls_with_warnings": warning_calls,
            "average_csat": round(avg_csat, 2) if avg_csat else None,
            "medication_adherent_calls": adherence_calls,
            "confirmed_appointments": confirmed_appointments,
            "open_escalations": open_escalations,
        }
        logger.info(f"✅ KPIs returned successfully: {kpis}")
        return kpis
    except Exception as e:
        logger.error(f"❌ Error fetching KPIs: {e}", exc_info=True)
        raise


@router.get("/kpis/trend", response_model=List[Dict])
async def get_kpi_trend(
    db: AsyncSession = Depends(get_db),
    _: CareTeamUser = Depends(get_current_user),
    days: int = Query(30, ge=7, le=365),
) -> List[Dict]:
    """Get KPI trends over time (for charts)."""
    logger.info(f"📊 GET /api/analytics/kpis/trend called with days={days}")

    try:
        trend_data = []
        today = datetime.utcnow().date()
        logger.debug(f"Fetching trend data for {days} days ending {today}")

        for day_offset in range(days, -1, -1):
            current_date = today - timedelta(days=day_offset)
            start_of_day = datetime.combine(current_date, datetime.min.time())
            end_of_day = start_of_day + timedelta(days=1)

            # Calls completed on this date
            calls_result = await db.execute(
                select(func.count(OutreachCall.id)).where(
                    OutreachCall.ended_at >= start_of_day,
                    OutreachCall.ended_at < end_of_day,
                    OutreachCall.status == "completed",
                )
            )
            calls_today = calls_result.scalar() or 0

            # Escalations created today
            escalations_result = await db.execute(
                select(func.count(EscalationCase.id)).where(
                    EscalationCase.created_at >= start_of_day,
                    EscalationCase.created_at < end_of_day,
                )
            )
            escalations_today = escalations_result.scalar() or 0

            # Average CSAT for calls today
            csat_result = await db.execute(
                select(func.avg(OutreachCall.csat_score)).where(
                    OutreachCall.ended_at >= start_of_day,
                    OutreachCall.ended_at < end_of_day,
                    OutreachCall.csat_score.isnot(None),
                )
            )
            csat_today = csat_result.scalar() or 0

            trend_data.append(
                {
                    "date": current_date.isoformat(),
                    "calls_completed": calls_today,
                    "escalations_created": escalations_today,
                    "average_csat": round(csat_today, 2) if csat_today else None,
                }
            )

        logger.info(f"✅ Trend data returned: {len(trend_data)} days")
        return trend_data
    except Exception as e:
        logger.error(f"❌ Error fetching trend data: {e}", exc_info=True)
        raise
