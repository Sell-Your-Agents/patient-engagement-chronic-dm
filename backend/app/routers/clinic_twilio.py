"""Twilio webhooks for calls INTO the clinic number.

These only register the call and hand the audio to the agent stream (/twilio/stream/{call_sid}).

Twilio console setup (no code change needed when a real number is added):
- Phone number > Voice > "A call comes in":   POST {API_BASE_URL}/twilio/clinic/inbound
- Phone number > Voice > "Call status changes": POST {API_BASE_URL}/twilio/clinic/status
- Browser calling: a TwiML App with Voice Request URL POST {API_BASE_URL}/twilio/clinic/inbound
  (and Status Callback {API_BASE_URL}/twilio/clinic/status), see routers/browser_call.py
"""
import logging
from datetime import datetime
from typing import Optional, Tuple

from fastapi import APIRouter, Depends, Request
from fastapi.responses import PlainTextResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from twilio.request_validator import RequestValidator
from twilio.twiml.voice_response import VoiceResponse

from app.config import get_settings
from app.database import get_db
from app.models.call_log import CHANNEL_BROWSER, CHANNEL_PHONE, CallLog
from app.models.callback_schedule import (
    FOLLOWUP_DONE,
    FOLLOWUP_PENDING,
    TRANSFER_ANSWERED,
    TRANSFER_NOT_ANSWERED,
    FollowUp,
)
from app.models.patient import Patient
from app.routers.twilio_webhook import apply_call_status
from app.services.agent.context_shared import lookup_caller, set_inbound_recording
from app.services.public_url import public_request_url, public_ws_url
from app.services.voice.telephony import busy_message_wav, hold_twiml, play_busy_message

logger = logging.getLogger(__name__)
settings = get_settings()
router = APIRouter(prefix="/twilio/clinic", tags=["clinic-twilio"])
validator = RequestValidator(settings.twilio_auth_token)


@router.post("/inbound")
async def clinic_inbound(request: Request, db: AsyncSession = Depends(get_db)):
    """Twilio Voice webhook for the clinic number: log the call and stream audio to our websocket."""
    form_data = await request.form()
    if not validator.validate(public_request_url(request), dict(form_data), request.headers.get("X-Twilio-Signature", "")):
        logger.warning("Invalid Twilio signature (clinic inbound)")
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
        browser = _is_browser(form_data)
        db.add(
            CallLog(
                channel=CHANNEL_BROWSER if browser else CHANNEL_PHONE,
                phone_number=caller[:20] or None,
                patient_id=patient.id if patient else None,
                patient_name=patient.name if patient else None,
                call_sid=call_sid,
                status="in-progress",
                started_at=datetime.utcnow(),
            )
        )
        await db.commit()
        set_inbound_recording(call_sid, recorded)
        logger.info(
            f"[{call_sid}] Incoming call from {caller or 'unknown number'}"
            f"{' (browser)' if browser else ''}{', patient #' + str(patient.id) if patient else ''}, recorded={recorded}"
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
    A browser call has no number, so the page says which number to pretend to call from
    (CallerNumber, optional) and whether to record (Record).
    """
    if not _is_browser(form_data):
        caller = str(form_data.get("From", "")).strip()
        return await lookup_caller(db, caller), caller, settings.call_recording_enabled

    recorded = form_data.get("Record") == "true"
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


# ---------- Live transfer to the front desk (see services/voice/telephony.py) ----------

@router.api_route("/hold", methods=["GET", "POST"])
async def hold_music():
    """Twilio fetches this while the caller waits for the front desk: soft music, looped."""
    return PlainTextResponse(hold_twiml(), media_type="application/xml")


@router.get("/busy-audio")
async def busy_audio(lang: str = "en"):
    """The 'all our staff are busy' message in Maya's voice, as WAV, for Twilio to play."""
    try:
        return Response(content=await busy_message_wav(lang), media_type="audio/wav")
    except Exception as exc:
        logger.error(f"Busy message audio failed ({lang}): {exc}")
        return Response(status_code=503)


NOT_ANSWERED_STATUSES = ("no-answer", "busy", "failed", "canceled")


@router.post("/transfer-status")
async def transfer_status(request: Request, caller: str, fu: int, lang: str = "en", db: AsyncSession = Depends(get_db)):
    """Status of the call to the front desk: answered -> done; not answered -> busy message + open follow-up."""
    form_data = await request.form()
    if not validator.validate(public_request_url(request), dict(form_data), request.headers.get("X-Twilio-Signature", "")):
        return PlainTextResponse("Unauthorized", status_code=403)
    status = str(form_data.get("CallStatus", ""))
    task = await db.get(FollowUp, fu)
    call = (await db.execute(select(CallLog).where(CallLog.call_sid == caller))).scalar_one_or_none()
    logger.info(f"[{caller}] Front desk call status: {status}")

    if status == "in-progress" and task:
        task.transfer_status = TRANSFER_ANSWERED
        task.status = FOLLOWUP_DONE
        task.completed_at = datetime.utcnow()
        task.staff_notes = ((task.staff_notes + " ") if task.staff_notes else "") + "Connected live to the front desk."
        if call:
            call.status = "transferred"
            call.outcome = "Transferred to clinic staff"
            call.next_action = "Handled by clinic staff (transferred)"
        await db.commit()
    elif status in NOT_ANSWERED_STATUSES:
        if task and task.transfer_status != TRANSFER_ANSWERED:
            task.transfer_status = TRANSFER_NOT_ANSWERED
            task.status = FOLLOWUP_PENDING
            task.reason = (task.reason or "Wants to talk to staff") + " (front desk did not answer)"
        if call:
            call.status = "completed"
            call.outcome = "Transfer not answered"
            call.next_action = "Clinic staff to call back"
        await db.commit()
        await play_busy_message(caller, lang)
    return PlainTextResponse("OK")
