from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "sqlite+aiosqlite:///./patient_engagement.db"
    jwt_secret_key: str
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30

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
