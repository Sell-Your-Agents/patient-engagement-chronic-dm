from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Unknown keys in .env (left over from older versions) are ignored, not an error
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False, extra="ignore")

    database_url: str = ""
    # PostgreSQL schema this app uses (e.g. "six-sigma"). Empty = the database's default ("public").
    # Every table is created and read only inside this schema, so other apps in the same database
    # are never touched. The schema must already exist.
    database_schema: str = ""
    jwt_secret_key: str
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    # Refresh tokens keep an active user signed in. Each refresh restarts this window,
    # so a user is signed out only after this long without the app making any request.
    refresh_token_expire_minutes: int = 720

    # Twilio voice
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_phone_number: str = ""
    # Browser calling ("Call the Agent" page, Twilio Voice SDK): a Twilio API key and a TwiML App
    # whose Voice URL is {API_BASE_URL}/twilio/clinic/inbound
    twilio_api_key_sid: str = ""
    twilio_api_key_secret: str = ""
    twilio_twiml_app_sid: str = ""
    # The clinic's incoming number, once there is one (shown on the "Call the Agent" page only).
    # Calls to it reach the agent when its Twilio "A call comes in" webhook is
    # POST {API_BASE_URL}/twilio/clinic/inbound; no code change is needed.
    clinic_inbound_number: str = ""
    # Phone number of the clinic front desk (e.g. +919876543210). When set, a caller who asks for a
    # person is put on hold (soft music) while this number rings; if nobody answers within
    # human_transfer_ring_seconds, the caller hears a "staff are busy" message and a follow-up is
    # left for the clinic team. When empty, the agent takes a message (follow-up) instead.
    # Works on phone calls and "Through Twilio" browser calls, not on direct browser tests.
    human_transfer_number: str = ""
    human_transfer_ring_seconds: int = 15
    # Hold music played while the front desk rings (an mp3/wav URL Twilio can fetch)
    hold_music_url: str = "http://com.twilio.music.classical.s3.amazonaws.com/ith_chopin-15-2.mp3"

    # Ending calls nobody is using: if the caller says nothing for SILENCE_REPROMPT_SECONDS the agent
    # asks "Are you still there?"; after SILENCE_HANGUP_SECONDS more of silence it says goodbye and
    # hangs up. No call lasts longer than MAX_CALL_MINUTES (0 = no limit).
    silence_reprompt_seconds: int = 8
    silence_hangup_seconds: int = 8
    max_call_minutes: int = 15

    # Record phone calls on our own server (services/voice/call_recorder.py). When on, the agent's
    # opening line says so. Browser test calls choose for themselves on the "Call the Agent" page.
    call_recording_enabled: bool = False
    # Folder for the recordings (one WAV per call, about 1 MB per minute). Relative = inside backend/.
    recordings_dir: str = "recordings"

    # AI services
    anthropic_api_key: str = ""
    deepgram_api_key: str = ""
    deepgram_project_id: str = ""
    sarvam_api_key: str = ""
    # Agent voice: "sarvam" (default) or "plivo" (testing)
    tts_provider: str = "sarvam"
    # Plivo realtime text-to-speech, used when tts_provider is "plivo"
    plivo_auth_id: str = ""
    plivo_auth_token: str = ""
    # Override the Plivo TTS WebSocket address; empty = the standard one for plivo_auth_id
    plivo_tts_url: str | None = None
    # Voice used when a call's language has no voice of its own
    plivo_tts_default_language: str = "en-IN"
    plivo_tts_default_voice_id: str = "H25SvwivznBqsIx1R7hX"
    # Audio format Plivo sends back (Twilio media streams need 8 kHz mu-law)
    plivo_tts_sample_rate: int = 8000
    plivo_tts_encoding: str = "pcm_mulaw"
    # Speaking speed, 1.0 = normal: English a little faster, Telugu / Hindi a little slower for clarity
    plivo_tts_pace_en: float = 1.1
    plivo_tts_pace: float = 0.9

    @property
    def plivo_tts_ws_url(self) -> str:
        return self.plivo_tts_url or f"wss://api.plivo.com/v1/Account/{self.plivo_auth_id}/TTS/Realtime/"

    # Application
    app_name: str = "Six Sigma Clinic AI Calling Agent"
    api_base_url: str = "http://localhost:8000"
    # Path prefix when served behind a reverse proxy (e.g. "/patientpulse-api"); empty locally
    root_path: str = ""
    app_port: int = 8000

    # ---- Clinic-specific configuration ----
    clinic_name: str = "Six Sigma Clinic"
    clinic_agent_name: str = "Maya"
    clinic_utc_offset_minutes: int = 330  # IST (UTC+5:30); clinic schedules use local clinic time
    clinic_booking_days_ahead: int = 7
    # Clinic facts the agent may share (empty = "not listed": the agent offers a callback)
    clinic_phone: str = ""
    clinic_address: str = ""
    clinic_hours: str = ""
    clinic_fees: str = ""
    # Languages the agent offers, in order: en (English), hi (Hindi), te (Telugu)
    clinic_languages: str = "en,hi,te"

    # Appointment system integration: "none" = no clinic system, every request is stored as
    # pending and confirmed by staff. See services/scheduling/appointment_service.py.
    appointment_integration: str = "none"

    # Safety wording used by the agent (doctor to approve before going live)
    emergency_number: str = "9674675335"
    ambulance_number: str = "108"
    mental_health_helpline: str = "the Tele-MANAS helpline on 14416, which is free and open all day and night"

    # Hours clinic staff return calls (clinic time); used to suggest a callback time
    staff_callback_start: str = "09:00"
    staff_callback_end: str = "20:00"


@lru_cache()
def get_settings():
    return Settings()
