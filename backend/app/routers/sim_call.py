"""Direct browser test call: talk to the agent from the "Call the Agent" page with no Twilio at all.

The browser opens a websocket here and speaks the same protocol Twilio Media Streams use
(start / media with 8 kHz mu-law audio / stop). After a short auth message, the call is logged
as an inbound call and handed to the very same handler a real phone call uses
(services/agent/call_agent.run_call_stream), so the agent, prompts, tokens and call log are identical.

Needs only ANTHROPIC_API_KEY, DEEPGRAM_API_KEY and SARVAM_API_KEY. Nothing is recorded.

Protocol (browser -> server):
  1. {"event": "auth", "token": "<JWT>", "patient_id": 3 | null, "caller_number": "+91...",
      "announce_recording": false}
  2. server replies {"event": "sim_call", "call_id": 12, "call_sid": "SIM..."} (or {"event": "error"})
  3. {"event": "start", "start": {"streamSid": "<any id>"}}, then {"event": "media", "media": {"payload": "<base64>"}}
     every 20 ms, and {"event": "stop"} to hang up. The agent's audio comes back as "media" events.
"""
import asyncio
import json
import logging
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, WebSocket
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import decode_access_token
from app.database import get_db
from app.models.call_log import DIRECTION_INBOUND, CallLog
from app.models.patient import Patient
from app.models.user import User
from app.services.agent.call_agent import run_call_stream
from app.services.agent.call_context import lookup_caller
from app.services.agent.context_shared import set_inbound_recording

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/sim-call", tags=["sim-call"])

AUTH_TIMEOUT_SECONDS = 15
SIM_SID_PREFIX = "SIM"  # never "CA...", so it can't be mistaken for a Twilio call


async def _user_from_token(db: AsyncSession, token: str) -> Optional[User]:
    try:
        user_id = int(decode_access_token(token).get("sub"))
    except (JWTError, TypeError, ValueError):
        return None
    user = await db.get(User, user_id)
    return user if user and user.is_active else None


async def _refuse(websocket: WebSocket, message: str) -> None:
    try:
        await websocket.send_json({"event": "error", "message": message})
        await websocket.close(code=1008)
    except Exception:
        pass


@router.websocket("/stream")
async def sim_call_stream(websocket: WebSocket, db: AsyncSession = Depends(get_db)):
    await websocket.accept()
    # The JWT comes in the first message (not the URL), so it never appears in access logs
    try:
        first = json.loads(await asyncio.wait_for(websocket.receive_text(), timeout=AUTH_TIMEOUT_SECONDS))
    except Exception:
        await _refuse(websocket, "No login details were received.")
        return
    if not isinstance(first, dict) or first.get("event") != "auth":
        await _refuse(websocket, "The call did not start correctly. Reload the page and try again.")
        return
    user = await _user_from_token(db, str(first.get("token") or ""))
    if not user:
        await _refuse(websocket, "Your login has expired. Log in again and retry.")
        return

    patient = None
    patient_id = first.get("patient_id")
    if isinstance(patient_id, int) or (isinstance(patient_id, str) and patient_id.isdigit()):
        patient = await db.get(Patient, int(patient_id))
    caller = str(first.get("caller_number") or "").strip()
    if patient:
        caller = patient.phone_number or ""
    elif caller:
        patient = await lookup_caller(db, caller)

    call_sid = f"{SIM_SID_PREFIX}{uuid.uuid4().hex[:24]}"
    call = CallLog(
        direction=DIRECTION_INBOUND,
        channel="browser",
        phone_number=caller[:20] or None,
        patient_id=patient.id if patient else None,
        patient_name=f"{patient.first_name} {patient.last_name}" if patient else None,
        call_sid=call_sid,
        status="in-progress",
        started_at=datetime.utcnow(),
    )
    db.add(call)
    await db.commit()
    # Only the spoken notice: a direct test call is never recorded
    set_inbound_recording(call_sid, bool(first.get("announce_recording")))
    logger.info(
        f"[{call_sid}] Direct browser test call by user #{user.id}"
        f"{', as patient #' + str(patient.id) if patient else ''}{', number ' + caller if caller else ''}"
    )

    await websocket.send_json({"event": "sim_call", "call_id": call.id, "call_sid": call_sid})
    await run_call_stream(websocket, call_sid, db, accept=False)
