"""The media-stream websocket every call's audio runs through, and the shared call-status update."""
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, WebSocket
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.call_log import CallLog
from app.services.agent.call_agent import run_call_stream

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/twilio", tags=["twilio"])


async def apply_call_status(db: AsyncSession, call_sid: str, call_status: str, duration: str = "") -> bool:
    """Apply a Twilio status callback to a call. False if the call is unknown."""
    result = await db.execute(select(CallLog).where(CallLog.call_sid == call_sid))
    call = result.scalar_one_or_none()
    if not call:
        return False

    logger.info(f"[{call_sid}] Call status: {call_status}")
    if call_status in ("failed", "busy", "no-answer", "canceled") and call.status == "in-progress":
        call.status = "failed"
        call.ended_at = datetime.utcnow()
    elif call_status == "completed":
        if call.status == "in-progress":
            call.status = "completed"
        call.ended_at = call.ended_at or datetime.utcnow()
        if duration and duration.isdigit():
            call.duration_seconds = int(duration)
    await db.commit()
    return True


@router.websocket("/stream/{call_sid}")
async def websocket_stream(websocket: WebSocket, call_sid: str, db: AsyncSession = Depends(get_db)):
    """The one media-stream endpoint for every call; the agent's context comes from the call row."""
    logger.info(f"[{call_sid}] WebSocket connection attempt")
    await run_call_stream(websocket, call_sid, db)
