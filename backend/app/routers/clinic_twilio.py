"""Twilio voice endpoints for the missed-call callback agent."""
import asyncio
import json
import logging
from datetime import datetime

from fastapi import APIRouter, Request, WebSocket, Depends
from fastapi.responses import PlainTextResponse
from twilio.request_validator import RequestValidator
from twilio.twiml.voice_response import VoiceResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.config import get_settings
from app.models.clinic import ClinicCall, MissedCall
from app.services.stt_service import SarvamStream
from app.services.audio_utils import decode_twilio_payload
from app.services.clinic_agent import ClinicCallSession, build_clinic_prompt, finalize_clinic_call

logger = logging.getLogger(__name__)
settings = get_settings()
router = APIRouter(prefix="/twilio/clinic", tags=["clinic-twilio"])
validator = RequestValidator(settings.twilio_auth_token)

# Twilio call status -> missed call status when the callback did not connect
UNANSWERED = {"no-answer": "no_answer", "busy": "no_answer", "failed": "failed", "canceled": "failed"}


async def _get_call(db: AsyncSession, call_sid: str):
    result = await db.execute(select(ClinicCall).where(ClinicCall.call_sid == call_sid))
    return result.scalar_one_or_none()


@router.post("/twiml")
async def clinic_twiml(request: Request, db: AsyncSession = Depends(get_db)):
    """Twilio asks what to do once the patient picks up: stream audio to our websocket."""
    form_data = await request.form()
    if not validator.validate(str(request.url), dict(form_data), request.headers.get("X-Twilio-Signature", "")):
        logger.warning("❌ Invalid Twilio signature (clinic twiml)")
        return PlainTextResponse("Unauthorized", status_code=403)

    call_sid = form_data.get("CallSid", "")
    clinic_call = await _get_call(db, call_sid)
    response = VoiceResponse()
    if not clinic_call:
        response.say("Sorry, we could not find your call information. Goodbye.")
        response.hangup()
        return PlainTextResponse(str(response), media_type="application/xml")

    clinic_call.status = "in-progress"
    clinic_call.started_at = datetime.utcnow()
    await db.commit()

    host = request.headers.get("Host", "localhost")
    connect = response.connect()
    connect.stream(url=f"wss://{host}/twilio/clinic/stream/{call_sid}")
    logger.info(f"[{call_sid}] Clinic callback answered, connecting media stream")
    return PlainTextResponse(str(response), media_type="application/xml")


@router.post("/status")
async def clinic_call_status(request: Request, db: AsyncSession = Depends(get_db)):
    """Twilio status callbacks: ringing / in-progress / completed / no-answer / busy / failed."""
    form_data = await request.form()
    if not validator.validate(str(request.url), dict(form_data), request.headers.get("X-Twilio-Signature", "")):
        return PlainTextResponse("Unauthorized", status_code=403)

    call_sid = form_data.get("CallSid", "")
    call_status = form_data.get("CallStatus", "")
    clinic_call = await _get_call(db, call_sid)
    if not clinic_call:
        return PlainTextResponse("Call not found", status_code=404)

    logger.info(f"[{call_sid}] Clinic call status: {call_status}")
    if call_status == "ringing" and clinic_call.status == "initiated":
        clinic_call.status = "ringing"
    elif call_status in UNANSWERED:
        clinic_call.status = call_status
        clinic_call.ended_at = datetime.utcnow()
        missed_call = await db.get(MissedCall, clinic_call.missed_call_id)
        if missed_call and missed_call.status == "calling":
            missed_call.status = UNANSWERED[call_status]
    elif call_status == "completed":
        clinic_call.ended_at = clinic_call.ended_at or datetime.utcnow()
        if form_data.get("CallDuration"):
            clinic_call.duration_seconds = int(form_data.get("CallDuration"))
        # Answered calls are finalized by the websocket handler; this covers calls that never streamed
        if not clinic_call.started_at:
            clinic_call.status = "no-answer"
            missed_call = await db.get(MissedCall, clinic_call.missed_call_id)
            if missed_call and missed_call.status == "calling":
                missed_call.status = "no_answer"
    await db.commit()
    return PlainTextResponse("OK")


@router.websocket("/stream/{call_sid}")
async def clinic_stream(websocket: WebSocket, call_sid: str, db: AsyncSession = Depends(get_db)):
    await websocket.accept()
    session = None
    try:
        clinic_call = await _get_call(db, call_sid)
        if not clinic_call:
            logger.error(f"[{call_sid}] Clinic call not found")
            await websocket.close(code=1008)
            return
        missed_call = await db.get(MissedCall, clinic_call.missed_call_id)

        session = ClinicCallSession(websocket, call_sid, clinic_call, missed_call)
        session.db = db
        session.set_prompt(await build_clinic_prompt(db, missed_call))
        session.selected_digit = "3"  # English

        async def on_transcript(transcript: str, is_final: bool):
            asyncio.create_task(session.handle_transcript(transcript, is_final))

        session.sarvam_stt = SarvamStream(on_transcript=on_transcript, selected_digit="3")
        try:
            await session.sarvam_stt.start()
        except Exception as exc:
            logger.error(f"[{call_sid}] Failed to start STT: {exc}")

        while session.is_call_active:
            data = json.loads(await websocket.receive_text())
            event = data.get("event")
            if event == "start":
                session.stream_sid = data["start"]["streamSid"]
                greeting = session.greeting()
                await session.add_turn("assistant", greeting)
                asyncio.create_task(session.speak(greeting))
            elif event == "media":
                if session.sarvam_stt:
                    await session.sarvam_stt.send_audio(decode_twilio_payload(data["media"]["payload"]))
            elif event == "stop":
                logger.info(f"[{call_sid}] Clinic stream stopped")
                break

    except Exception as exc:
        logger.error(f"[{call_sid}] Clinic stream error: {exc}", exc_info=True)
    finally:
        if session:
            session.is_call_active = False
            transcript = session.transcript_text
            await session.close()
            try:
                await finalize_clinic_call(db, session.clinic_call.id, transcript)
            except Exception as exc:
                logger.error(f"[{call_sid}] Clinic finalize error: {exc}", exc_info=True)
        try:
            await websocket.close()
        except Exception:
            pass
