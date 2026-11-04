import logging
from datetime import datetime

from fastapi import APIRouter, Request, WebSocket, Depends
from fastapi.responses import PlainTextResponse
from twilio.request_validator import RequestValidator
from twilio.twiml.voice_response import VoiceResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.database import get_db
from app.config import get_settings
from app.models.call_log import CallLog, DIRECTION_OUTBOUND
from app.services.call_agent import run_call_stream
from app.services.public_url import public_request_url, public_ws_url

logger = logging.getLogger(__name__)

settings = get_settings()
router = APIRouter(prefix="/twilio", tags=["twilio"])
validator = RequestValidator(settings.twilio_auth_token)


@router.post("/twiml")
async def twiml_response(request: Request, db: AsyncSession = Depends(get_db)):
    """TwiML for an outbound check-in call that the patient has just answered.

    Opens the media stream; the shared stream handler builds the agent's context from the call.
    """
    logger.info("📞 TwiML request received")

    # Validate Twilio request signature
    form_data = await request.form()
    url = public_request_url(request)
    if not validator.validate(url, dict(form_data), request.headers.get("X-Twilio-Signature", "")):
        logger.warning("❌ Invalid Twilio signature")
        return PlainTextResponse("Unauthorized", status_code=403)

    call_sid = form_data.get("CallSid", "")
    logger.info(f"📞 Call SID: {call_sid}, From: {form_data.get('From', '')}")

    # Find the outbound Call this is for
    result = await db.execute(
        select(CallLog)
        .where(CallLog.call_sid == call_sid, CallLog.direction == DIRECTION_OUTBOUND)
        .options(joinedload(CallLog.patient))
    )
    call = result.unique().scalar_one_or_none()

    if not call or not call.patient:
        response = VoiceResponse()
        response.say("Sorry, we could not find your call information.")
        response.hangup()
        return PlainTextResponse(str(response), media_type="application/xml")

    # Update call status
    call.status = "in-progress"
    call.started_at = datetime.utcnow()
    await db.commit()

    response = VoiceResponse()
    logger.info(f"✅ Building TwiML for patient {call.patient.first_name}")
    response.say(
        f"Hello, is this {call.patient.first_name}? "
        f"This is {settings.clinic_agent_name} from {settings.clinic_name}, calling to check in on how you're doing. "
        "Let me connect you now."
    )

    ws_url = public_ws_url(f"/twilio/stream/{call_sid}")
    logger.info(f"📡 WebSocket URL: {ws_url}")
    connect = response.connect()
    connect.stream(url=ws_url)

    twiml_str = str(response)
    logger.info(f"📤 Returning TwiML:\n{twiml_str[:500]}")
    return PlainTextResponse(twiml_str, media_type="application/xml")


async def apply_call_status(db: AsyncSession, call_sid: str, call_status: str, duration: str = "") -> bool:
    """Apply a Twilio status callback to a call of either direction. False if the call is unknown."""
    result = await db.execute(select(CallLog).where(CallLog.call_sid == call_sid))
    call = result.scalar_one_or_none()
    if not call:
        return False

    logger.info(f"[{call_sid}] {call.direction} call status: {call_status}")
    if call_status in ("failed", "busy", "no-answer", "canceled"):
        call.status = "no-answer" if call_status == "no-answer" else "failed"
        call.ended_at = datetime.utcnow()
    elif call_status == "completed":
        call.status = "completed"
        call.ended_at = call.ended_at or datetime.utcnow()
        if duration:
            call.duration_seconds = int(duration)
    await db.commit()
    return True


@router.post("/status")
async def call_status_update(request: Request, db: AsyncSession = Depends(get_db)):
    """Handle Twilio call status updates (webhooks)."""
    form_data = await request.form()
    url = public_request_url(request)
    if not validator.validate(url, dict(form_data), request.headers.get("X-Twilio-Signature", "")):
        return PlainTextResponse("Unauthorized", status_code=403)

    found = await apply_call_status(
        db, form_data.get("CallSid", ""), form_data.get("CallStatus", ""), form_data.get("CallDuration", "")
    )
    if not found:
        return PlainTextResponse("Call not found", status_code=404)
    return PlainTextResponse("OK")


@router.websocket("/stream/{call_sid}")
async def websocket_stream(websocket: WebSocket, call_sid: str, db: AsyncSession = Depends(get_db)):
    """The one media-stream endpoint for every call; the agent's context comes from the Call row."""
    logger.info(f"[{call_sid}] WebSocket connection attempt")
    await run_call_stream(websocket, call_sid, db)
