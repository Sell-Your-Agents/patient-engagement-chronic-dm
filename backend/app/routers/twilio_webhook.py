import asyncio
import json
import base64
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Request, WebSocket, Depends
from fastapi.responses import PlainTextResponse
from twilio.request_validator import RequestValidator
from twilio.twiml.voice_response import VoiceResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.database import get_db
from app.config import get_settings
from app.models.outreach_call import OutreachCall
from app.services.twilio_service import CallSession
from app.services.prompt_builder import build_system_prompt
from app.services.call_finalizer import finalize_call, handle_failed_call
from app.services.stt_service import SarvamStream
from app.services.audio_utils import decode_twilio_payload

logger = logging.getLogger(__name__)

settings = get_settings()
router = APIRouter(prefix="/twilio", tags=["twilio"])
validator = RequestValidator(settings.twilio_auth_token)

# In-memory store of active call sessions (in production, use Redis)
active_calls = {}


@router.post("/twiml")
async def twiml_response(request: Request, db: AsyncSession = Depends(get_db)):
    """Generate TwiML response for incoming Twilio call.

    Initiates a MediaStream connection for real-time audio streaming.
    """
    logger.info("📞 TwiML request received")

    # Validate Twilio request signature
    form_data = await request.form()
    url = str(request.url)
    if not validator.validate(url, dict(form_data), request.headers.get("X-Twilio-Signature", "")):
        logger.warning("❌ Invalid Twilio signature")
        return PlainTextResponse("Unauthorized", status_code=403)

    call_sid = form_data.get("CallSid", "")
    from_phone = form_data.get("From", "")
    logger.info(f"📞 Call SID: {call_sid}, From: {from_phone}")

    # Find the OutreachCall this is for
    result = await db.execute(
        select(OutreachCall)
        .where(OutreachCall.call_sid == call_sid)
        .options(
            joinedload(OutreachCall.patient),
            joinedload(OutreachCall.care_plan),
        )
    )
    outreach_call = result.unique().scalar_one_or_none()

    if not outreach_call:
        response = VoiceResponse()
        response.say("Sorry, we could not find your call information.")
        response.hangup()
        return PlainTextResponse(str(response), media_type="application/xml")

    # Update call status
    outreach_call.status = "in-progress"
    outreach_call.started_at = datetime.utcnow()
    await db.commit()

    # Generate system prompt for this patient
    care_plan = outreach_call.care_plan
    protocol = care_plan.patient_condition.disease_protocol if care_plan else None

    if not protocol:
        # Fallback: just a generic greeting
        system_prompt = f"""You are a health coaching AI calling on behalf of Patient Engagement Center.
Say hello to {outreach_call.patient.first_name} and explain you're calling to check in on their health."""
    else:
        system_prompt = build_system_prompt(
            patient=outreach_call.patient,
            care_plan=care_plan,
            protocol=protocol,
        )

    # Build TwiML response with MediaStream
    response = VoiceResponse()
    logger.info(f"✅ Building TwiML for patient {outreach_call.patient.first_name}")

    response.say(
        f"Hello, is this {outreach_call.patient.first_name}? "
        "I'm calling from your health coaching team to check in on how you're doing. "
        "Let me connect you with our health coach now."
    )

    # Connect to websocket stream
    host = request.headers.get('Host', 'localhost')
    ws_url = f"wss://{host}/twilio/stream/{call_sid}"
    logger.info(f"📡 WebSocket URL: {ws_url}")

    connect = response.connect()
    connect.stream(
        url=ws_url,
        parameters=json.dumps(
            {
                "outreach_call_id": outreach_call.id,
                "system_prompt": system_prompt,
                "patient_language": outreach_call.patient.preferred_language,
            }
        ),
    )

    twiml_str = str(response)
    logger.info(f"📤 Returning TwiML:\n{twiml_str[:500]}")
    return PlainTextResponse(twiml_str, media_type="application/xml")


@router.post("/status")
async def call_status_update(request: Request, db: AsyncSession = Depends(get_db)):
    """Handle Twilio call status updates (webhooks)."""
    # Validate signature
    form_data = await request.form()
    url = str(request.url)
    if not validator.validate(url, dict(form_data), request.headers.get("X-Twilio-Signature", "")):
        return PlainTextResponse("Unauthorized", status_code=403)

    call_sid = form_data.get("CallSid", "")
    call_status = form_data.get("CallStatus", "")

    # Find the call
    result = await db.execute(
        select(OutreachCall).where(OutreachCall.call_sid == call_sid)
    )
    call = result.scalar_one_or_none()

    if not call:
        return PlainTextResponse("Call not found", status_code=404)

    # Update status
    if call_status == "completed":
        call.status = "completed"
    elif call_status == "failed":
        call.status = "failed"
    elif call_status == "no-answer":
        call.status = "no-answer"

    call.ended_at = datetime.utcnow()
    await db.commit()

    return PlainTextResponse("OK")


async def handle_media_stream(websocket: WebSocket, call_sid: str, db: AsyncSession, system_prompt: str, patient_language: str, outreach_call) -> None:
    """Handle complete media stream - receives all events including connected/start."""
    session = CallSession(websocket, call_sid)
    session.db = db
    session.system_prompt = system_prompt
    session.selected_digit = "3"
    session.outreach_call = outreach_call

    # Initialize STT with callback
    async def on_transcript_callback(transcript: str, is_final: bool):
        asyncio.create_task(session.handle_transcript(transcript, is_final))

    stt_client = SarvamStream(on_transcript=on_transcript_callback, selected_digit="3")
    session.sarvam_stt = stt_client

    try:
        await stt_client.start()
        logger.info(f"[{call_sid}] STT client started")
    except Exception as exc:
        logger.error(f"[{call_sid}] Failed to start STT: {exc}")

    try:
        while session.is_call_active:
            raw = await websocket.receive_text()
            data = json.loads(raw)
            event = data.get("event")

            if event == "connected":
                logger.info(f"[{call_sid}] Received connected event")

            elif event == "start":
                session.stream_sid = data["start"]["streamSid"]
                logger.info(f"[{call_sid}] Stream started: {session.stream_sid}")
                # Send greeting via speak()
                greeting = f"Hello {outreach_call.patient.first_name}, I'm your health coach. How are you feeling today?"
                await session.add_turn("assistant", greeting)
                asyncio.create_task(session.speak(greeting))

            elif event == "media":
                if not session.is_call_active:
                    break
                mulaw_bytes = decode_twilio_payload(data["media"]["payload"])
                if session.sarvam_stt:
                    await session.sarvam_stt.send_audio(mulaw_bytes)

            elif event == "stop":
                logger.info(f"[{call_sid}] Stream stopped")
                session.is_call_active = False
                break

    except Exception as exc:
        logger.error(f"[{call_sid}] WebSocket error: {exc}", exc_info=True)
    finally:
        session.is_call_active = False
        await session.close()


@router.websocket("/stream/{call_sid}")
async def websocket_stream(websocket: WebSocket, call_sid: str, db: AsyncSession = Depends(get_db)):
    """WebSocket endpoint - accepts connection and delegates to handle_media_stream."""
    logger.info(f"[{call_sid}] WebSocket connection attempt")
    await websocket.accept()
    logger.info(f"[{call_sid}] WebSocket accepted")

    try:
        # Find the OutreachCall
        result = await db.execute(
            select(OutreachCall)
            .where(OutreachCall.call_sid == call_sid)
            .options(
                joinedload(OutreachCall.patient),
                joinedload(OutreachCall.care_plan),
            )
        )
        outreach_call = result.unique().scalar_one_or_none()

        if not outreach_call:
            logger.error(f"[{call_sid}] OutreachCall not found")
            await websocket.close(code=1008)
            return

        # Build system prompt
        care_plan = outreach_call.care_plan
        protocol = (
            care_plan.patient_condition.disease_protocol
            if care_plan and care_plan.patient_condition
            else None
        )

        if protocol:
            system_prompt = build_system_prompt(
                patient=outreach_call.patient,
                care_plan=care_plan,
                protocol=protocol,
            )
        else:
            system_prompt = (
                f"You are a friendly health coach calling {outreach_call.patient.first_name}."
            )

        # Delegate to media stream handler (handles all events including connected/start)
        await handle_media_stream(
            websocket=websocket,
            call_sid=call_sid,
            db=db,
            system_prompt=system_prompt,
            patient_language=outreach_call.patient.preferred_language,
            outreach_call=outreach_call,
        )

        # Finalize call
        logger.info(f"[{call_sid}] Finalizing call...")
        await finalize_call(
            outreach_call_id=outreach_call.id,
            db=db,
            transcript="",
            duration_seconds=0,
        )

    except Exception as e:
        logger.error(f"[{call_sid}] WebSocket error: {e}", exc_info=True)
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
