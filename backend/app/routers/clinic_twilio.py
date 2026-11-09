"""Twilio webhooks for calls INTO the clinic number.

These only register the call and hand the audio to the shared agent stream
(/twilio/stream/{call_sid}); the agent itself is the same one that makes outbound calls.

Twilio console setup (no code change needed when a real number is added):
- Phone number > Voice > "A call comes in":   POST {API_BASE_URL}/twilio/clinic/inbound
- Phone number > Voice > "Call status changes": POST {API_BASE_URL}/twilio/clinic/status
- Browser calling: a TwiML App with Voice Request URL POST {API_BASE_URL}/twilio/clinic/inbound
  (and Status Callback {API_BASE_URL}/twilio/clinic/status), see routers/browser_call.py
e.g. API_BASE_URL = https://callingapp-dev.zensark.com/patientpulse-api
"""
import logging
from datetime import datetime
from typing import Optional, Tuple

from fastapi import APIRouter, Request, Depends
from fastapi.responses import PlainTextResponse
from twilio.request_validator import RequestValidator
from twilio.twiml.voice_response import VoiceResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.config import get_settings
from app.models.call_log import CallLog, DIRECTION_INBOUND
from app.models.patient import Patient
from app.routers.twilio_webhook import apply_call_status
from app.services.agent.call_context import lookup_caller
from app.services.agent.context_shared import set_inbound_recording
from app.services.public_url import public_request_url, public_ws_url

logger = logging.getLogger(__name__)
settings = get_settings()
router = APIRouter(prefix="/twilio/clinic", tags=["clinic-twilio"])
validator = RequestValidator(settings.twilio_auth_token)


@router.post("/inbound")
async def clinic_inbound(request: Request, db: AsyncSession = Depends(get_db)):
    """Twilio Voice webhook for the clinic number: log the call and stream audio to our websocket."""
    form_data = await request.form()
    if not validator.validate(public_request_url(request), dict(form_data), request.headers.get("X-Twilio-Signature", "")):
        logger.warning("❌ Invalid Twilio signature (clinic inbound)")
        return PlainTextResponse("Unauthorized", status_code=403)

    call_sid = form_data.get("CallSid", "")
    response = VoiceResponse()
    if not call_sid:
        response.say("Sorry, something went wrong. Goodbye.")
        response.hangup()
        return PlainTextResponse(str(response), media_type="application/xml")

    # Twilio can retry the webhook; keep one row per CallSid
    existing = await db.execute(select(CallLog.id).where(CallLog.call_sid == call_sid))
    if existing.scalar_one_or_none() is None:
        patient, caller, recorded = await _identify_caller(db, form_data)
        db.add(
            CallLog(
                direction=DIRECTION_INBOUND,
                phone_number=caller[:20] or None,
                patient_id=patient.id if patient else None,
                patient_name=f"{patient.first_name} {patient.last_name}" if patient else None,
                call_sid=call_sid,
                status="in-progress",
                started_at=datetime.utcnow(),
            )
        )
        await db.commit()
        set_inbound_recording(call_sid, recorded)
        logger.info(
            f"[{call_sid}] Inbound call from {caller or 'unknown number'}"
            f"{' (browser)' if _is_browser(form_data) else ''}"
            f"{', patient #' + str(patient.id) if patient else ''}, recorded={recorded}"
        )

    connect = response.connect()
    connect.stream(url=public_ws_url(f"/twilio/stream/{call_sid}"))
    return PlainTextResponse(str(response), media_type="application/xml")


def _is_browser(form_data) -> bool:
    """Calls from the 'Call the Agent' page come from a Twilio Voice SDK client, not a phone."""
    return str(form_data.get("From", "")).startswith("client:")


async def _identify_caller(db: AsyncSession, form_data) -> Tuple[Optional[Patient], str, bool]:
    """Who is calling and whether to record.

    A phone call is matched to a patient by its number and follows the recording setting.
    A browser call has no number, so the page says who to play: a chosen patient (PatientId)
    or a new caller with an optional typed-in number (CallerNumber), and whether to record (Record).
    """
    if not _is_browser(form_data):
        caller = str(form_data.get("From", "")).strip()
        return await lookup_caller(db, caller), caller, settings.call_recording_enabled

    recorded = form_data.get("Record") == "true"
    patient_id = str(form_data.get("PatientId", "")).strip()
    if patient_id.isdigit():
        patient = await db.get(Patient, int(patient_id))
        if patient:
            return patient, patient.phone_number or "", recorded
    caller = str(form_data.get("CallerNumber", "")).strip()
    return (await lookup_caller(db, caller) if caller else None), caller, recorded


@router.post("/status")
async def clinic_call_status(request: Request, db: AsyncSession = Depends(get_db)):
    """Optional Twilio status callback (set as the number's 'Call status changes' URL)."""
    form_data = await request.form()
    if not validator.validate(public_request_url(request), dict(form_data), request.headers.get("X-Twilio-Signature", "")):
        return PlainTextResponse("Unauthorized", status_code=403)

    found = await apply_call_status(
        db, form_data.get("CallSid", ""), form_data.get("CallStatus", ""), form_data.get("CallDuration", "")
    )
    if not found:
        return PlainTextResponse("Call not found", status_code=404)
    return PlainTextResponse("OK")
