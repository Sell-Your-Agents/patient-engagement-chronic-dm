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

    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache()
def get_settings():
    return Settings()
