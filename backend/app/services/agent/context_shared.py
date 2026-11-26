"""Pieces the call context needs: the CallContext type, capabilities, languages, recording choice,
shared prompt rules and caller lookup."""
import logging
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.call_log import CallLog
from app.models.patient import Patient
from app.prompts.common_prompts import CLINIC_INFO, CORE_RULES, RECORDING_LINES
from app.services.scheduling.clinic_scheduling import clinic_now

logger = logging.getLogger(__name__)
settings = get_settings()

# Control-token capabilities
CAP_APPOINTMENT_REQUEST = "appointment_request"  # [[APPOINTMENT_REQUEST ...]]
CAP_APPOINTMENT_CHANGE = "appointment_change"  # [[APPOINTMENT_RESCHEDULE ...]] / [[APPOINTMENT_CANCEL ...]]
CAP_CALLBACK = "callback"  # [[CALLBACK_REQUEST ...]]
CAP_HUMAN = "human_assistance"  # [[HUMAN_ASSISTANCE ...]]
CAP_ESCALATE = "escalate"  # [[ESCALATE:emergency|distress]]
CAP_UNANSWERED = "unanswered_question"  # [[UNANSWERED_QUESTION ...]]
CAP_LANGUAGE = "language"  # [[SET_LANGUAGE:en|hi|te]]

# ---------- Languages ----------
# Each language's speech-recognition and voice settings, by the digit stt_service / sarvam_tts_service use
LANGUAGE_NAMES = {"en": "English", "hi": "Hindi", "te": "Telugu"}
LANGUAGE_DIGITS = {"te": "1", "hi": "2", "en": "3"}
# Before the caller picks a language: Deepgram's multilingual model (Hindi + English) hears
# "English", "Hindi" and "Telugu" (also said in Hindi or Telugu) well enough to choose.
LISTEN_BEFORE_CHOICE_DIGIT = "2"


def offered_languages() -> List[str]:
    langs = [code.strip().lower() for code in settings.clinic_languages.split(",")]
    return [code for code in langs if code in LANGUAGE_NAMES] or ["en"]


@dataclass
class CallContext:
    system_prompt: str
    # (text, language) parts of the opening line, each spoken in its own language's voice
    greeting_parts: List[Tuple[str, str]]
    capabilities: frozenset
    patient: Optional[Patient] = None
    # Language to start in: None = ask the caller first
    language: Optional[str] = None
    extras: Dict[str, str] = field(default_factory=dict)

    @property
    def greeting(self) -> str:
        return " ".join(text for text, _ in self.greeting_parts)


# ---------- Small text helpers ----------

def one_line(text: str) -> str:
    """Collapse runs of spaces (an empty recording line leaves a double space)."""
    return " ".join(text.split())


def spoken_hhmm(value: str) -> str:
    """'09:00' -> '9 AM', '20:30' -> '8:30 PM'."""
    hours, minutes = (int(part) for part in value.split(":"))
    suffix = "AM" if hours < 12 else "PM"
    hour12 = hours % 12 or 12
    return f"{hour12} {suffix}" if minutes == 0 else f"{hour12}:{minutes:02d} {suffix}"


def now_text() -> str:
    return clinic_now().strftime("%A %d %b %Y, %I:%M %p")


def last_ten_digits(phone_number: Optional[str]) -> str:
    return re.sub(r"\D", "", phone_number or "")[-10:]


# ---------- Recording ----------
# Whether each call is recorded, by CallSid. Set by the inbound webhook / browser page and read when
# the media stream opens (same process); after a restart a call falls back to the setting.
_recording: Dict[str, bool] = {}


def set_inbound_recording(call_sid: str, recorded: bool) -> None:
    _recording[call_sid] = recorded
    if len(_recording) > 1000:  # only live calls need it
        for sid in list(_recording)[:500]:
            _recording.pop(sid, None)


def is_recorded(call: CallLog) -> bool:
    return _recording.get(call.call_sid or "", settings.call_recording_enabled)


def recording_line(call: CallLog, language: str = "en") -> str:
    """The recording notice for the opening line (in the greeting's language), or "" when not recorded."""
    return RECORDING_LINES.get(language, RECORDING_LINES["en"]) if is_recorded(call) else ""


# ---------- Shared prompt sections ----------

def shared_rules() -> str:
    """Core rules + clinic facts, appended to every call prompt.

    Clinic facts left empty in .env are simply not listed (the knowledge base may hold them), so the
    agent never sees "Address: not listed" next to an address in the knowledge base.
    """
    core = CORE_RULES.format(
        agent_name=settings.clinic_agent_name,
        org_name=settings.clinic_name,
        emergency_number=settings.emergency_number,
        mental_health_helpline=settings.mental_health_helpline,
    )
    facts = [
        ("Name", settings.clinic_name),
        ("Address", settings.clinic_address),
        ("Phone", settings.clinic_phone),
        ("Opening hours", settings.clinic_hours),
        ("Consultation fees", settings.clinic_fees),
        ("Emergency number in India", settings.emergency_number),
    ]
    lines = "\n".join(f"- {label}: {value.strip()}" for label, value in facts if value and value.strip())
    return core + CLINIC_INFO.format(lines=lines)


# ---------- Lookups ----------

async def lookup_caller(db: AsyncSession, phone_number: Optional[str]) -> Optional[Patient]:
    """The patient record for this number (matched on the last 10 digits), if any."""
    digits = last_ten_digits(phone_number)
    if len(digits) < 10:
        return None
    result = await db.execute(select(Patient).where(Patient.phone_number.like(f"%{digits}")).limit(1))
    return result.scalar_one_or_none()
