"""Twilio voice endpoints for patient calls (routine check-ins and feedback callbacks)."""
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
from app.models.outreach_call import OutreachCall
from app.models.patient import Patient
from app.services.stt_service import SarvamStream
from app.services.audio_utils import decode_twilio_payload
from app.services.public_url import public_request_url, public_ws_url
from app.services.feedback_agent import (
    PatientCallSession,
    build_call_prompt,
    finalize_feedback_call,
    load_patient_context,
)

logger = logging.getLogger(__name__)
settings = get_settings()
router = APIRouter(prefix="/twilio", tags=["twilio"])
validator = RequestValidator(settings.twilio_auth_token)

UNANSWERED = {"no-answer", "busy", "failed", "canceled"}


async def _get_call(db: AsyncSession, call_sid: str):
    result = await db.execute(select(OutreachCall).where(OutreachCall.call_sid == call_sid))
    return result.scalar_one_or_none()


@router.post("/twiml")
async def twiml_response(request: Request, db: AsyncSession = Depends(get_db)):
    """Twilio asks what to do once the patient picks up: stream audio to our websocket."""
    form_data = await request.form()
    if not validator.validate(public_request_url(request), dict(form_data), request.headers.get("X-Twilio-Signature", "")):
        logger.warning("❌ Invalid Twilio signature (patient twiml)")
        return PlainTextResponse("Unauthorized", status_code=403)

    call_sid = form_data.get("CallSid", "")
    outreach_call = await _get_call(db, call_sid)
    response = VoiceResponse()
    if not outreach_call:
        response.say("Sorry, we could not find your call information. Goodbye.")
        response.hangup()
        return PlainTextResponse(str(response), media_type="application/xml")

    outreach_call.status = "in-progress"
    outreach_call.started_at = datetime.utcnow()
    await db.commit()

    if outreach_call.purpose != "feedback":
        patient = await db.get(Patient, outreach_call.patient_id)
        response.say(
            f"Hello, is this {patient.first_name}? "
            "I'm calling from your health coaching team to check in on how you're doing. "
            "Let me connect you with our health coach now."
        )

    connect = response.connect()
    connect.stream(url=public_ws_url(f"/twilio/stream/{call_sid}"))
    logger.info(f"[{call_sid}] Patient call answered ({outreach_call.purpose}), connecting media stream")
    return PlainTextResponse(str(response), media_type="application/xml")


@router.post("/status")
async def call_status_update(request: Request, db: AsyncSession = Depends(get_db)):
    """Twilio status callbacks: ringing / in-progress / completed / no-answer / busy / failed."""
    form_data = await request.form()
    if not validator.validate(public_request_url(request), dict(form_data), request.headers.get("X-Twilio-Signature", "")):
        return PlainTextResponse("Unauthorized", status_code=403)

    call_sid = form_data.get("CallSid", "")
    call_status = form_data.get("CallStatus", "")
    call = await _get_call(db, call_sid)
    if not call:
        return PlainTextResponse("Call not found", status_code=404)

    logger.info(f"[{call_sid}] Patient call status: {call_status}")
    if call_status == "ringing" and call.status == "initiated":
        call.status = "ringing"
    elif call_status in UNANSWERED:
        call.status = call_status
        call.ended_at = datetime.utcnow()
    elif call_status == "completed":
        call.ended_at = call.ended_at or datetime.utcnow()
        if form_data.get("CallDuration"):
            call.duration_seconds = int(form_data.get("CallDuration"))
        # Answered calls are finalized by the websocket handler; this covers calls that never streamed
        if not call.started_at:
            call.status = "no-answer"
    await db.commit()
    return PlainTextResponse("OK")


@router.websocket("/stream/{call_sid}")
async def websocket_stream(websocket: WebSocket, call_sid: str, db: AsyncSession = Depends(get_db)):
    await websocket.accept()
    session = None
    try:
        outreach_call = await _get_call(db, call_sid)
        if not outreach_call:
            logger.error(f"[{call_sid}] Outreach call not found")
            await websocket.close(code=1008)
            return

        ctx = await load_patient_context(db, outreach_call)
        session = PatientCallSession(websocket, call_sid, outreach_call, ctx)
        session.db = db
        session.system_prompt = build_call_prompt(ctx, session.purpose)
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
                logger.info(f"[{call_sid}] Patient stream stopped")
                break

    except Exception as exc:
        logger.error(f"[{call_sid}] Patient stream error: {exc}", exc_info=True)
    finally:
        if session:
            session.is_call_active = False
            transcript = session.transcript_text
            await session.close()
            try:
                await finalize_feedback_call(
                    db,
                    session.outreach_call.id,
                    transcript,
                    session.ctx,
                    session.escalations,
                    session.appointment_requested,
                )
            except Exception as exc:
                logger.error(f"[{call_sid}] Patient call finalize error: {exc}", exc_info=True)
        try:
            await websocket.close()
        except Exception:
            pass
