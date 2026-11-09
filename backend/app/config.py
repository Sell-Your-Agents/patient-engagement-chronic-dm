from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = ""
    jwt_secret_key: str
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60

    # Twilio voice
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_phone_number: str = ""
    # Browser calling ("Call the Agent" page, Twilio Voice SDK): a Twilio API key and a TwiML App
    # whose Voice URL is {API_BASE_URL}/twilio/clinic/inbound
    twilio_api_key_sid: str = ""
    twilio_api_key_secret: str = ""
    twilio_twiml_app_sid: str = ""
    # The clinic's real incoming number, once you have one (shown on the "Call the Agent" page only).
    # Calls to it reach the agent when its Twilio "A call comes in" webhook is
    # POST {API_BASE_URL}/twilio/clinic/inbound; no code change is needed.
    clinic_inbound_number: str = ""

    # Record calls (outbound and phone inbound). When on, the agent's opening line says so.
    # Browser test calls choose for themselves on the "Call the Agent" page.
    call_recording_enabled: bool = False

    # AI services
    anthropic_api_key: str = ""
    deepgram_api_key: str = ""
    deepgram_project_id: str = ""
    sarvam_api_key: str = ""

    # Application configuration
    app_name: str = "Patient Engagement for Chronic Disease Management"
    org_name: str = "Hospital System"
    api_base_url: str = "http://localhost:8000"
    # Path prefix when served behind a reverse proxy (e.g. "/patientpulse-api"); empty locally
    root_path: str = ""
    app_port: int = 8000

    # Scheduler configuration
    scheduler_poll_seconds: int = 60
    # How often due callbacks ("call me back") are dialled
    callback_poll_seconds: int = 30
    # Scheduled health check-ins: the agent calls patients whose care plan is due (clinic time)
    checkin_dialer_enabled: bool = True
    checkin_call_start: str = "09:00"
    checkin_call_end: str = "20:00"
    # Testing only: > 0 repeats check-ins (and missed-call retries) every N minutes instead of
    # the plan's interval in days, at any hour
    checkin_test_interval_minutes: int = 0
    max_retry_attempts: int = 3
    retry_backoff_minutes: str = "2,6,1440"

    # Agent configuration
    agent_name: str = "Health Assistant"

    # Missed-call callback agent (single clinic for now)
    clinic_name: str = "Sunrise Multispeciality Clinic"
    clinic_agent_name: str = "Maya"
    clinic_utc_offset_minutes: int = 330  # IST (UTC+5:30); clinic schedules use local clinic time
    clinic_booking_days_ahead: int = 7

    # Clinic facts the agent may share (empty = "not listed": the agent offers a front-desk callback)
    clinic_phone: str = ""
    clinic_address: str = ""
    clinic_hours: str = ""
    clinic_fees: str = ""

    # Safety wording used by the agent (doctor to approve before going live)
    emergency_number: str = "108"
    mental_health_helpline: str = "the Tele-MANAS helpline on 14416, which is free and open all day and night"
    hypo_first_aid: str = (
        "If you can swallow safely, please take something sugary right now, like a glass of juice or glucose."
    )

    # Time (HH:MM, clinic time) offered when a caller wants a callback but can't name a time
    default_callback_time: str = "10:00"

    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache()
def get_settings():
    return Settings()
