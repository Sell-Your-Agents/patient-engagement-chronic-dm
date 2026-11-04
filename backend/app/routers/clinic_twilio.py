"""Twilio webhooks for calls INTO the clinic number.

These only register the call and hand the audio to the shared agent stream
(/twilio/stream/{call_sid}); the agent itself is the same one that makes outbound calls.
"""
import logging
from datetime import datetime

from fastapi import APIRouter, Request, Depends
from fastapi.responses import PlainTextResponse
from twilio.request_validator import RequestValidator
from twilio.twiml.voice_response import VoiceResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.config import get_settings
from app.models.call_log import CallLog, DIRECTION_INBOUND
from app.routers.twilio_webhook import apply_call_status
from app.services.call_context import lookup_caller
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
    caller = form_data.get("From", "")
    response = VoiceResponse()
    if not call_sid:
        response.say("Sorry, something went wrong. Goodbye.")
        response.hangup()
        return PlainTextResponse(str(response), media_type="application/xml")

    # Twilio can retry the webhook; keep one row per CallSid
    existing = await db.execute(select(CallLog.id).where(CallLog.call_sid == call_sid))
    if existing.scalar_one_or_none() is None:
        patient = await lookup_caller(db, caller)
        db.add(
            CallLog(
                direction=DIRECTION_INBOUND,
                phone_number=caller,
                patient_id=patient.id if patient else None,
                call_sid=call_sid,
                status="in-progress",
                started_at=datetime.utcnow(),
            )
        )
        await db.commit()

    connect = response.connect()
    connect.stream(url=public_ws_url(f"/twilio/stream/{call_sid}"))
    logger.info(f"[{call_sid}] Inbound call from {caller}, connecting media stream")
    return PlainTextResponse(str(response), media_type="application/xml")


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
