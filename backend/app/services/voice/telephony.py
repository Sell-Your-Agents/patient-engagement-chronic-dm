"""Twilio REST actions on a live call: start recording, and transfer to the clinic front desk.

Transfer, step by step (a caller asked to talk to a person):
  1. Maya says "Please hold, I'm connecting you to our clinic team."
  2. The caller is moved into a small Twilio conference room where they hear soft hold music
     (HOLD_MUSIC_URL), and Twilio rings the front desk (HUMAN_TRANSFER_NUMBER) for
     HUMAN_TRANSFER_RING_SECONDS.
  3a. Staff pick up: they hear who is calling, then join the room and talk to the caller.
      The follow-up is marked done ("talked to staff").
  3b. Nobody picks up (or busy / failed): the caller hears "Sorry, all our staff are busy..." in
      their language, in Maya's voice, and the call ends. The follow-up stays open for a callback.
Steps 3a/3b are driven by Twilio's status callback: routers/clinic_twilio.py::transfer_status.
"""
import asyncio
import audioop
import io
import logging
import wave
from typing import Dict, Optional
from urllib.parse import urlencode

from twilio.rest import Client
from twilio.twiml.voice_response import Dial, VoiceResponse

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# Browser test calls (routers/sim_call.py) have no Twilio call behind them
SIM_SID_PREFIX = "SIM"

# Said to the caller when nobody at the front desk picks up (in Maya's voice, the caller's language)
BUSY_MESSAGES = {
    "en": "Sorry, all our staff are busy right now. We have passed on your details, and our clinic team will contact you soon. Thank you for calling.",
    "hi": "माफ़ कीजिए, अभी हमारे सभी staff व्यस्त हैं। हमने आपकी जानकारी आगे भेज दी है, हमारी clinic team जल्द ही आपसे संपर्क करेगी। call करने के लिए धन्यवाद।",
    "te": "క్షమించండి, ప్రస్తుతం మా సిబ్బంది అందరూ బిజీగా ఉన్నారు. మీ వివరాలు పంపించాము, మా clinic team త్వరలో మిమ్మల్ని సంప్రదిస్తారు. call చేసినందుకు ధన్యవాదాలు.",
}
LANGUAGE_DIGITS = {"te": "1", "hi": "2", "en": "3"}
_busy_audio_cache: Dict[str, bytes] = {}


def twilio_configured() -> bool:
    return bool(settings.twilio_account_sid and settings.twilio_auth_token)


def is_twilio_call(call_sid: Optional[str]) -> bool:
    return bool(call_sid) and not call_sid.startswith(SIM_SID_PREFIX) and twilio_configured()


def can_transfer(call_sid: Optional[str]) -> bool:
    """A live transfer needs a front-desk number, a Twilio number to call from, and a real Twilio call."""
    return bool(settings.human_transfer_number and settings.twilio_phone_number) and is_twilio_call(call_sid)


def _client() -> Client:
    return Client(settings.twilio_account_sid, settings.twilio_auth_token)


def _url(path: str, **params) -> str:
    url = f"{settings.api_base_url.rstrip('/')}{path}"
    return f"{url}?{urlencode(params)}" if params else url


async def start_call_recording(call_sid: Optional[str]) -> None:
    """Start recording a call that is already connected (inbound calls can only be recorded this way)."""
    if not is_twilio_call(call_sid):
        return
    try:
        await asyncio.to_thread(_client().calls(call_sid).recordings.create)
        logger.info(f"[{call_sid}] Recording started")
    except Exception as exc:
        logger.warning(f"[{call_sid}] Could not start recording: {exc}")


def _room(call_sid: str) -> str:
    return f"clinic-transfer-{call_sid}"


async def transfer_call(call_sid: str, follow_up_id: int, language: str, caller_name: Optional[str], reason: Optional[str]) -> bool:
    """Put the caller on hold music and ring the front desk. False if the transfer could not start."""
    if not can_transfer(call_sid):
        return False
    language = language if language in BUSY_MESSAGES else "en"
    client = _client()

    # What staff hear when they pick up, before joining the caller
    staff = VoiceResponse()
    whisper = f"Call from the clinic A I line. {caller_name or 'A caller'} would like to speak to someone"
    whisper += f", about {reason}." if reason else "."
    staff.say(whisper + " Connecting you now.", voice="Polly.Aditi", language="en-IN")
    staff_dial = Dial()
    staff_dial.conference(_room(call_sid), start_conference_on_enter=True, end_conference_on_exit=True, beep=False)
    staff.append(staff_dial)

    try:
        await asyncio.to_thread(
            client.calls.create,
            to=settings.human_transfer_number,
            from_=settings.twilio_phone_number,
            twiml=str(staff),
            timeout=settings.human_transfer_ring_seconds,
            status_callback=_url("/twilio/clinic/transfer-status", caller=call_sid, fu=follow_up_id, lang=language),
            status_callback_event=["answered", "completed"],
            status_callback_method="POST",
        )
    except Exception as exc:
        logger.error(f"[{call_sid}] Could not ring the front desk: {exc}")
        return False

    # The caller waits in the room with hold music until staff join (or the busy message replaces it)
    caller = VoiceResponse()
    caller_dial = Dial()
    caller_dial.conference(
        _room(call_sid),
        start_conference_on_enter=False,
        end_conference_on_exit=True,
        beep=False,
        wait_url=_url("/twilio/clinic/hold"),
        wait_method="POST",
    )
    caller.append(caller_dial)
    try:
        await asyncio.to_thread(client.calls(call_sid).update, twiml=str(caller))
    except Exception as exc:
        logger.error(f"[{call_sid}] Could not put the caller on hold: {exc}")
        return False
    logger.info(f"[{call_sid}] On hold; ringing the front desk for {settings.human_transfer_ring_seconds}s")
    return True


def hold_twiml() -> str:
    response = VoiceResponse()
    response.play(settings.hold_music_url, loop=0)
    return str(response)


async def play_busy_message(call_sid: str, language: str) -> None:
    """Nobody picked up: replace the hold music with the busy message, then hang up."""
    language = language if language in BUSY_MESSAGES else "en"
    response = VoiceResponse()
    response.play(_url("/twilio/clinic/busy-audio", lang=language))
    response.hangup()
    try:
        await asyncio.to_thread(_client().calls(call_sid).update, twiml=str(response))
        logger.info(f"[{call_sid}] Front desk did not answer; busy message played")
    except Exception as exc:
        # Usually the caller already hung up while waiting
        logger.info(f"[{call_sid}] Could not play the busy message (caller may have hung up): {exc}")


async def busy_message_wav(language: str) -> bytes:
    """The busy message as a WAV file in Maya's voice (Sarvam), cached per language."""
    language = language if language in BUSY_MESSAGES else "en"
    if language not in _busy_audio_cache:
        from app.services.voice.sarvam_tts_service import text_to_mulaw

        mulaw = await text_to_mulaw(BUSY_MESSAGES[language], LANGUAGE_DIGITS[language])
        pcm = audioop.ulaw2lin(mulaw, 2)
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(8000)
            wav.writeframes(pcm)
        _busy_audio_cache[language] = buffer.getvalue()
    return _busy_audio_cache[language]
