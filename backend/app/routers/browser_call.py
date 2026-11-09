"""Browser calling: logged-in staff phone the agent from the "Call the Agent" page (Twilio Voice SDK).

The browser connects to a TwiML App whose Voice URL is /twilio/clinic/inbound, so the call takes
exactly the same path as a patient dialling the clinic number.

Setup (Twilio console), then set the three values in backend/.env:
1. Account > API keys & tokens > Create API key (Standard)  -> TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET
2. Voice > TwiML Apps > Create new TwiML App
     Voice Request URL:    POST {API_BASE_URL}/twilio/clinic/inbound
     Status Callback URL:  POST {API_BASE_URL}/twilio/clinic/status
                                                            -> TWILIO_TWIML_APP_SID
TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must also be set (the webhook checks Twilio's signature).
"""
from fastapi import APIRouter, Depends, HTTPException
from twilio.jwt.access_token import AccessToken
from twilio.jwt.access_token.grants import VoiceGrant

from app.auth.deps import get_current_user
from app.config import get_settings
from app.models.user import User

settings = get_settings()
router = APIRouter(prefix="/api/browser-call", tags=["browser-call"])

TOKEN_TTL_SECONDS = 3600


def browser_calling_configured() -> bool:
    return bool(
        settings.twilio_account_sid
        and settings.twilio_auth_token
        and settings.twilio_api_key_sid
        and settings.twilio_api_key_secret
        and settings.twilio_twiml_app_sid
    )


def _missing_settings() -> list:
    names = {
        "TWILIO_ACCOUNT_SID": settings.twilio_account_sid,
        "TWILIO_AUTH_TOKEN": settings.twilio_auth_token,
        "TWILIO_API_KEY_SID": settings.twilio_api_key_sid,
        "TWILIO_API_KEY_SECRET": settings.twilio_api_key_secret,
        "TWILIO_TWIML_APP_SID": settings.twilio_twiml_app_sid,
    }
    return [name for name, value in names.items() if not value]


def _direct_missing() -> list:
    """Keys the direct (no Twilio) browser test needs: the AI, speech-to-text and voice services."""
    names = {
        "ANTHROPIC_API_KEY": settings.anthropic_api_key,
        "DEEPGRAM_API_KEY": settings.deepgram_api_key,
        "SARVAM_API_KEY": settings.sarvam_api_key,
    }
    return [name for name, value in names.items() if not value]


@router.get("/status")
async def status(_: User = Depends(get_current_user)):
    """What each way of calling the agent needs, and the URLs to put in the Twilio console."""
    base = settings.api_base_url.rstrip("/")
    return {
        "direct_ready": not _direct_missing(),
        "direct_missing": _direct_missing(),
        "inbound_number": settings.clinic_inbound_number,
        "configured": browser_calling_configured(),
        "missing": _missing_settings(),
        "voice_url": f"{base}/twilio/clinic/inbound",
        "status_url": f"{base}/twilio/clinic/status",
        "recording_default": settings.call_recording_enabled,
        "agent_name": settings.clinic_agent_name,
        "clinic_name": settings.clinic_name,
    }


@router.post("/token")
async def token(user: User = Depends(get_current_user)):
    """Short-lived token that lets this browser place one kind of call: to the clinic agent."""
    if not browser_calling_configured():
        raise HTTPException(
            status_code=503,
            detail="Browser calling is not set up yet. Missing in backend/.env: " + ", ".join(_missing_settings()),
        )
    identity = f"staff-{user.id}"
    access = AccessToken(
        settings.twilio_account_sid,
        settings.twilio_api_key_sid,
        settings.twilio_api_key_secret,
        identity=identity,
        ttl=TOKEN_TTL_SECONDS,
    )
    # Outgoing only: the browser can call the agent, nothing can ring the browser
    access.add_grant(VoiceGrant(outgoing_application_sid=settings.twilio_twiml_app_sid, incoming_allow=False))
    jwt = access.to_jwt()
    return {"token": jwt.decode() if isinstance(jwt, bytes) else jwt, "identity": identity}
