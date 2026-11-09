"""Pieces every call context needs, inbound and outbound.

outbound_context.py and inbound_context.py build the prompt, opening line and capabilities for
their own calls from these helpers; call_context.py only decides which of the two a call uses.
"""
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Sequence

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.config import get_settings
from app.models.call_log import DIRECTION_OUTBOUND, CallLog, CallTurn
from app.models.callback_schedule import SCHEDULE_TYPE_STAFF, CallbackSchedule
from app.models.condition import PatientCondition
from app.models.disease_protocol import DiseaseProtocol
from app.models.patient import Patient
from app.models.plan import Plan
from app.prompts.common_prompts import (
    CALLBACK_INSTRUCTIONS,
    CALLBACK_WHY_NOT_REACHED,
    CALLBACK_WHY_REQUESTED,
    CALLBACK_WHY_STAFF,
    CALLER_IDENTITY_RULES,
    CALLER_IDENTITY_RULES_UNKNOWN,
    CLINIC_INFO,
    CORE_RULES,
    PREVIOUS_CONVERSATIONS,
    RECORDING_LINE,
)
from app.services.scheduling.callback_service import find_callback_for_call, find_source_call
from app.services.scheduling.clinic_scheduling import clinic_now

logger = logging.getLogger(__name__)
settings = get_settings()

# Control-token capabilities
CAP_BOOK = "book"  # [[BOOK_APPOINTMENT ...]] books a real slot
CAP_ESCALATE = "escalate"  # [[ESCALATE:id]] raises an escalation case right away
CAP_APPOINTMENT_REQUEST = "appointment_request"  # [[APPOINTMENT_REQUESTED]] (staff arrange the time)
CAP_CALLBACK = "callback"  # [[SCHEDULE_CALLBACK ...]] caller asked us to call them back

# Earlier calls a callback remembers (follows callback-of-a-callback chains), and how much of each
HISTORY_MAX_CALLS = 3
HISTORY_MAX_CHARS_PER_CALL = 6000
TOKEN_IN_TRANSCRIPT_RE = re.compile(r"\[\[\s*(.*?)\s*\]\]", re.DOTALL)

# Who answered an earlier call (from its after-call summary) when it was not the patient
NOT_REACHED_ANSWERS = ("family_member", "other_person", "voicemail", "nobody")


@dataclass
class CallContext:
    system_prompt: str
    greeting: str
    capabilities: frozenset
    patient: Optional[Patient] = None
    plan: Optional[Plan] = None

    @property
    def patient_full_name(self) -> Optional[str]:
        return full_name(self.patient)


# ---------- Small text helpers ----------

def full_name(patient: Optional[Patient]) -> Optional[str]:
    return f"{patient.first_name} {patient.last_name}".strip() if patient else None


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


# Inbound calls: whether each one is recorded, by CallSid. Set by the inbound webhook and read when
# the media stream opens (same process). Kept in memory so no database column is needed; after a
# restart an unknown call falls back to settings.call_recording_enabled.
_inbound_recording: Dict[str, bool] = {}


def set_inbound_recording(call_sid: str, recorded: bool) -> None:
    _inbound_recording[call_sid] = recorded
    if len(_inbound_recording) > 1000:  # keep the map small; only live calls need it
        for sid in list(_inbound_recording)[:500]:
            _inbound_recording.pop(sid, None)


def is_recorded(call: CallLog) -> bool:
    """Outbound calls follow the recording setting; inbound calls use what the webhook decided."""
    if call.direction == DIRECTION_OUTBOUND:
        return settings.call_recording_enabled
    return _inbound_recording.get(call.call_sid or "", settings.call_recording_enabled)


def recording_line(call: CallLog) -> str:
    """The recording notice for the opening line, or "" when the call is not recorded."""
    return RECORDING_LINE if is_recorded(call) else ""


def physician_spoken(name: Optional[str]) -> str:
    """'Dr. Ananya Rao' -> 'Doctor Ananya Rao' for speech; 'your doctor' when unknown."""
    if not name or not name.strip():
        return "your doctor"
    name = name.strip()
    return re.sub(r"^Dr\.?\s+", "Doctor ", name)


def red_flag_lines(protocol: Optional[DiseaseProtocol], fallback: str = "  - Any severe or rapidly worsening symptom [id: red_flag] (Urgent)") -> str:
    """One prompt line per red flag, always with its id and severity."""
    lines = []
    for criterion in (protocol.red_flag_criteria if protocol else None) or []:
        description = criterion.get("description")
        if not description:
            continue
        cid = criterion.get("id") or criterion.get("criterion_id") or "red_flag"
        severity = str(criterion.get("severity") or "high").capitalize()
        lines.append(f"  - {description} [id: {cid}] ({severity})")
    return "\n".join(lines) or fallback


# ---------- Shared prompt sections ----------

def _listed(value: str) -> str:
    return value.strip() if value and value.strip() else "not listed"


def shared_rules() -> str:
    """Core rules + clinic facts + callback rules, appended to every call prompt."""
    now = clinic_now()
    example = (now + timedelta(days=1)).replace(hour=10, minute=0).strftime("%Y-%m-%dT%H:%M")
    core = CORE_RULES.format(
        agent_name=settings.clinic_agent_name,
        org_name=settings.clinic_name,
        emergency_number=settings.emergency_number,
        hypo_first_aid=settings.hypo_first_aid,
        mental_health_helpline=settings.mental_health_helpline,
    )
    clinic = CLINIC_INFO.format(
        org_name=settings.clinic_name,
        clinic_address=_listed(settings.clinic_address),
        clinic_phone=_listed(settings.clinic_phone),
        clinic_hours=_listed(settings.clinic_hours),
        fees_text=_listed(settings.clinic_fees),
        emergency_number=settings.emergency_number,
    )
    callbacks = CALLBACK_INSTRUCTIONS.format(
        now=now.strftime("%A %d %b %Y, %I:%M %p"),
        calling_hours_start=spoken_hhmm(settings.checkin_call_start),
        calling_hours_end=spoken_hhmm(settings.checkin_call_end),
        default_callback_time=spoken_hhmm(settings.default_callback_time),
        example=example,
    )
    return core + clinic + callbacks


def caller_identity_rules(name: Optional[str]) -> str:
    """Identity rules for a call Maya places, by name when known."""
    if not name:
        return CALLER_IDENTITY_RULES_UNKNOWN
    return CALLER_IDENTITY_RULES.format(full_name=name, first_name=name.split()[0])


# ---------- Lookups ----------

async def lookup_caller(db: AsyncSession, phone_number: str) -> Optional[Patient]:
    """Find the chronic-care patient who owns this number (matched on the last 10 digits)."""
    digits = re.sub(r"\D", "", phone_number or "")[-10:]
    if len(digits) < 10:
        return None
    result = await db.execute(
        select(Patient)
        .where(
            Patient.status == "active",
            or_(Patient.phone_number.like(f"%{digits}"), Patient.secondary_phone.like(f"%{digits}")),
        )
        .limit(1)
    )
    return result.scalar_one_or_none()


def _plan_query():
    return select(Plan).options(
        joinedload(Plan.protocol),
        joinedload(Plan.patient_condition).joinedload(PatientCondition.chronic_condition),
    )


async def load_plan(db: AsyncSession, plan_id: int) -> Optional[Plan]:
    result = await db.execute(_plan_query().where(Plan.id == plan_id))
    return result.unique().scalar_one_or_none()


async def find_active_plan(db: AsyncSession, patient_id: int) -> Optional[Plan]:
    result = await db.execute(
        _plan_query()
        .where(Plan.patient_id == patient_id, Plan.status == "active")
        .order_by(Plan.id)
        .limit(1)
    )
    return result.unique().scalar_one_or_none()


async def patient_condition_names(db: AsyncSession, patient_id: int) -> List[str]:
    """Display names of the patient's active conditions that have an active care plan."""
    result = await db.execute(
        select(PatientCondition)
        .options(joinedload(PatientCondition.chronic_condition))
        .join(Plan, Plan.patient_condition_id == PatientCondition.id)
        .where(
            PatientCondition.patient_id == patient_id,
            PatientCondition.status == "active",
            Plan.status == "active",
        )
    )
    return [pc.chronic_condition.display_name for pc in result.scalars().unique().all()]


# ---------- Callback history ----------

async def _transcript_lines(db: AsyncSession, call: CallLog) -> List[str]:
    """The call's conversation as (role, text) lines; control tokens become plain notes."""
    if call.transcript and call.transcript.strip():
        raw = [line.strip() for line in call.transcript.splitlines() if line.strip()]
    else:
        turns = await db.execute(
            select(CallTurn).where(CallTurn.call_log_id == call.id).order_by(CallTurn.timestamp, CallTurn.id)
        )
        raw = [f"{t.role.upper()}: {t.content}" for t in turns.scalars().all()]

    lines = []
    for line in raw:
        role, _, text = line.partition(":")
        if role not in ("ASSISTANT", "USER"):
            continue
        # Keep what the system did ("BOOKED appointment #5") but never in a form the agent would re-send
        text = TOKEN_IN_TRANSCRIPT_RE.sub(lambda m: f"(system note: {m.group(1)})", text).strip()
        if text:
            lines.append(f"{'You' if role == 'ASSISTANT' else 'Them'}: {text}")
    return lines


async def earlier_calls(db: AsyncSession, callback: CallbackSchedule) -> List[CallLog]:
    """The call(s) this callback follows on from, oldest first (follows callback-of-a-callback chains)."""
    calls: List[CallLog] = []
    seen = set()
    current: Optional[CallbackSchedule] = callback
    while current and len(calls) < HISTORY_MAX_CALLS:
        source = await find_source_call(db, current)
        if not source or source.id in seen:
            break
        calls.append(source)
        seen.add(source.id)
        current = await find_callback_for_call(db, source.id)  # was that call a callback too?
    calls.reverse()
    return calls


async def previous_conversations(db: AsyncSession, calls: Sequence[CallLog], who: Optional[str]) -> str:
    """Prompt section with the earlier conversations, so the agent remembers what was asked and answered."""
    if not calls:
        return ""
    offset = timedelta(minutes=settings.clinic_utc_offset_minutes)
    blocks = []
    for call in calls:
        when = (call.started_at or call.created_at or datetime.utcnow()) + offset
        lines = await _transcript_lines(db, call)
        conversation = "\n".join(lines)
        if len(conversation) > HISTORY_MAX_CHARS_PER_CALL:
            conversation = "(earlier part of this call trimmed)\n" + conversation[-HISTORY_MAX_CHARS_PER_CALL:]
        direction = "they phoned the clinic" if call.direction != DIRECTION_OUTBOUND else "you phoned them"
        block = f"--- Call on {when.strftime('%A %d %b %Y, %I:%M %p')} ({direction}) ---"
        if call.summary:
            block += f"\nSummary: {call.summary}"
        block += f"\nConversation:\n{conversation or '(nothing was recorded)'}"
        blocks.append(block)
    return PREVIOUS_CONVERSATIONS.format(blocks="\n\n".join(blocks), who=who or "the person who called earlier")


def callback_why(callback: CallbackSchedule, calls: Sequence[CallLog]) -> str:
    """Start of what Maya says after identity is confirmed: why she is calling back.

    Never claims "you asked us to call" when the clinic team scheduled it, or when someone
    else (a family member, voicemail) answered the earlier call.
    """
    if callback.schedule_type == SCHEDULE_TYPE_STAFF:
        return CALLBACK_WHY_STAFF
    last = calls[-1] if calls else None
    reached = ((last.structured_summary or {}) if last else {}).get("reached")
    if reached in NOT_REACHED_ANSWERS:
        return CALLBACK_WHY_NOT_REACHED
    return CALLBACK_WHY_REQUESTED


def earlier_text(calls: Sequence[CallLog]) -> str:
    """One line for the callback note: what happened before this call."""
    if len(calls) > 1:
        return "You have already spoken with this number more than once (see the previous conversations below)"
    if calls and calls[0].direction == DIRECTION_OUTBOUND:
        return "Earlier you phoned this number for a health check-in"
    return "Earlier this person phoned the clinic"
