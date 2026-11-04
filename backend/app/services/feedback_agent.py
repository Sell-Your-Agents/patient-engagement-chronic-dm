"""Patient call agent: routine check-in calls and feedback callbacks (disease, medicines, problems, questions)."""
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import List, Optional

import anthropic
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.models.appointment import Appointment
from app.models.care_plan import CarePlan
from app.models.condition import PatientCondition
from app.models.disease_protocol import DiseaseProtocol
from app.models.escalation_case import EscalationCase
from app.models.medication_reminder import MedicationReminder
from app.models.outreach_call import OutreachCall, ConversationTurn
from app.models.patient import Patient
from app.services.claude_service import client as claude_client
from app.services.prompt_builder import build_system_prompt
from app.services.twilio_service import CallSession

logger = logging.getLogger(__name__)
settings = get_settings()

ESCALATE_TOKEN_RE = re.compile(r"\[\[ESCALATE:\s*([^\]]*)\]\]")
APPOINTMENT_TOKEN = "[[APPOINTMENT_REQUESTED]]"
ANY_TOKEN_RE = re.compile(r"\[\[(?!END_CALL\]\])[^\]]*\]\]")


@dataclass
class PatientContext:
    patient: Patient
    care_plan: Optional[CarePlan]
    condition_name: str
    protocol: Optional[DiseaseProtocol]
    medications: List[str] = field(default_factory=list)
    # Most recent earlier call where the patient actually talked to the agent
    previous_call_id: Optional[int] = None
    previous_call_at: Optional[datetime] = None
    previous_summary: Optional[dict] = None
    # Running memory of every earlier call with this patient (Patient.call_memory)
    memory: Optional[dict] = None


# Outcomes where nothing useful was learned, so there is nothing to follow up on
EMPTY_OUTCOMES = {"no_conversation", "wrong_person", "call_later"}
PREVIOUS_CALLS_SCANNED = 10
# Calls folded into a patient's memory the first time it is built
MEMORY_BACKFILL_CALLS = 20
MEMORY_HISTORY_KEPT = 20


async def load_patient_context(db: AsyncSession, outreach_call: OutreachCall) -> PatientContext:
    """Load everything the agent needs up front (async sessions cannot lazy-load relationships)."""
    patient = await db.get(Patient, outreach_call.patient_id)

    care_plan = None
    if outreach_call.care_plan_id:
        result = await db.execute(
            select(CarePlan)
            .where(CarePlan.id == outreach_call.care_plan_id)
            .options(
                selectinload(CarePlan.patient_condition).selectinload(PatientCondition.chronic_condition),
                selectinload(CarePlan.protocol),
            )
        )
        care_plan = result.scalar_one_or_none()

    condition_name = "their long-term condition"
    if care_plan and care_plan.patient_condition and care_plan.patient_condition.chronic_condition:
        condition_name = care_plan.patient_condition.chronic_condition.display_name

    result = await db.execute(
        select(MedicationReminder.medication_name).where(MedicationReminder.patient_id == patient.id)
    )
    medications = sorted(set(result.scalars().all()))

    result = await db.execute(
        select(OutreachCall)
        .where(OutreachCall.patient_id == patient.id)
        .where(OutreachCall.id != outreach_call.id)
        .where(OutreachCall.structured_summary.isnot(None))
        .order_by(OutreachCall.created_at.desc())
        .limit(PREVIOUS_CALLS_SCANNED)
    )
    previous_call = next(
        (
            c for c in result.scalars().all()
            if c.structured_summary.get("summary") and c.structured_summary.get("outcome") not in EMPTY_OUTCOMES
        ),
        None,
    )

    return PatientContext(
        patient=patient,
        care_plan=care_plan,
        condition_name=condition_name,
        protocol=care_plan.protocol if care_plan else None,
        medications=medications,
        previous_call_id=previous_call.id if previous_call else None,
        previous_call_at=(previous_call.started_at or previous_call.created_at) if previous_call else None,
        previous_summary=previous_call.structured_summary if previous_call else None,
        memory=patient.call_memory,
    )


def format_memory(memory: dict) -> str:
    """The patient's memory as plain lines, for the agent."""
    lines = []
    if memory.get("overview"):
        lines.append(f"- Overview: {memory['overview']}")
    if memory.get("condition_trend"):
        lines.append(f"- Condition over time: {memory['condition_trend']}")
    for med in memory.get("medicines") or []:
        lines.append(f"- Medicine {med.get('name')}: {med.get('notes') or 'no issues'}")
    for issue in memory.get("ongoing_issues") or []:
        lines.append(f"- Still ongoing: {issue}")
    for question in memory.get("open_questions") or []:
        lines.append(f"- Waiting on the care team: {question}")
    for issue in memory.get("resolved_issues") or []:
        lines.append(f"- Resolved earlier: {issue}")
    for note in memory.get("personal_notes") or []:
        lines.append(f"- Personal: {note}")
    for entry in (memory.get("history") or [])[-5:]:
        lines.append(f"- Call on {entry.get('date')}: {entry.get('summary')}")
    return "\n".join(lines)


def format_previous_call(ctx: PatientContext) -> str:
    """The previous call's findings as plain lines, for the agent and the summarizer."""
    prev = ctx.previous_summary or {}
    lines = [f"- Date: {ctx.previous_call_at.strftime('%d %b %Y') if ctx.previous_call_at else 'unknown'}"]
    lines.append(f"- Summary: {prev.get('summary')}")
    if prev.get("disease_feedback") or prev.get("symptom_status"):
        lines.append(f"- Condition then: {prev.get('disease_feedback') or prev.get('symptom_status')}")
    for med in prev.get("medications") or []:
        notes = [
            f"working: {med['working']}" if med.get("working") else None,
            "not taking as prescribed" if med.get("taking_as_prescribed") is False else None,
            f"side effects: {med['side_effects']}" if med.get("side_effects") else None,
            f"missed doses: {med['missed_doses']}" if med.get("missed_doses") else None,
        ]
        lines.append(f"- Medicine {med.get('name')}: {'; '.join(n for n in notes if n) or 'no issues'}")
    for problem in prev.get("problems") or []:
        lines.append(f"- Problem: {problem}")
    for query in prev.get("patient_queries") or []:
        status = "passed to the doctor's team" if query.get("needs_doctor_followup") else "answered on the call"
        lines.append(f"- Question asked: {query.get('question')} ({status})")
    if prev.get("warning_sign_details"):
        lines.append(f"- Warning sign reported: {prev['warning_sign_details']}")
    if prev.get("appointment_requested") or prev.get("appointment_details"):
        lines.append(f"- Appointment requested: {prev.get('appointment_details') or 'yes'}")
    return "\n".join(lines)


def build_feedback_prompt(ctx: PatientContext) -> str:
    patient = ctx.patient
    protocol = ctx.protocol

    symptom_questions = "\n".join(
        f"  - {q['text']}"
        for q in (protocol.assessment_questions if protocol else [])
        if q.get("category") == "symptom"
    ) or "  - How have your symptoms been lately?"
    red_flags = "\n".join(
        f"  - {c['id']}: {c['description']} (severity: {c.get('severity', 'high')})"
        for c in (protocol.red_flag_criteria if protocol else [])
    ) or "  - none listed; use your judgement for anything that sounds serious"

    if ctx.medications:
        medication_hint = f"Medicines on record: {', '.join(ctx.medications)}. Ask about each one by name."
    elif protocol and protocol.medication_classes:
        medication_hint = (
            "No medicine list on record. Ask the patient which medicines they take. "
            f"Typical medicines for this condition: {', '.join(protocol.medication_classes)}."
        )
    else:
        medication_hint = "No medicine list on record. Ask the patient which medicines they take."

    physician = ctx.care_plan.assigned_physician_name if ctx.care_plan else None
    last_contact = (
        ctx.care_plan.last_outreach_at.strftime("%d %b %Y")
        if ctx.care_plan and ctx.care_plan.last_outreach_at
        else "this is the first follow-up call"
    )
    steps = [
        f"Confirm you are speaking with {patient.first_name} and that now is a good time. If not, ask when to call back, thank them and end the call."
    ]
    previous_block = ""
    if ctx.memory:
        previous_block += (
            f"\n\nWHAT WE REMEMBER ABOUT {patient.first_name.upper()} FROM "
            f"{ctx.memory.get('calls_remembered', 0)} EARLIER CALLS\n{format_memory(ctx.memory)}"
        )
    if ctx.previous_summary:
        previous_block += f"\n\nWHAT THE PATIENT TOLD US ON THE LAST CALL\n{format_previous_call(ctx)}"
        steps.append(
            "LAST CALL FOLLOW-UP: mention that you spoke last time, then go through what they told you, one item at a time.\n"
            "   Ask whether each problem, side effect or missed-dose issue is now better, the same or worse. Ask whether their question "
            "was answered by the doctor's team and whether any requested appointment happened.\n"
            "   Also check on anything listed as still ongoing or waiting on the care team from earlier calls.\n"
            "   If something is the same or worse, ask a little more about it. Skip anything already covered in this call."
        )
    steps += [
        f"DISEASE: ask how they have been feeling with their {ctx.condition_name}. Ask a few of these, not all of them:\n{symptom_questions}",
        f"MEDICINES: {medication_hint}\n"
        "   For each medicine find out: are they taking it as prescribed, is it working for them, any side effects, any missed doses and why (cost, forgetting, side effects, ran out).",
        "PROBLEMS: ask if they are facing any new problems — with the treatment, daily life, diet, getting medicines or reaching the clinic.",
        "QUESTIONS: ask if they have any questions for the care team. Answer simple general questions briefly. For anything about changing doses, "
        "new medicines or test results, say you will pass the question to their doctor's team, who will get back to them.",
        "Ask if they would like an appointment with their doctor. If they say yes, write [[APPOINTMENT_REQUESTED]] and tell them the clinic will call to confirm a time.",
        "Ask them to rate this call and the care they are getting from 1 to 5.",
        "Briefly sum up anything you will pass on to the doctor, thank them, say goodbye.",
    ]
    goal = "\n".join(f"{i}. {s}" for i, s in enumerate(steps, 1))

    return f"""You are {settings.clinic_agent_name}, a warm and caring health assistant calling on behalf of {settings.clinic_name}.
You are on a live PHONE call with a patient who has {ctx.condition_name}. This is a follow-up call to collect their feedback.

PATIENT
- Name: {patient.first_name} {patient.last_name}
- Condition: {ctx.condition_name}
- Doctor: {physician or 'their doctor'}
- Last contact: {last_contact}{previous_block}

YOUR GOAL — go through these topics in order, one question at a time, and keep it natural:
{goal}

WARNING SIGNS
Watch for these:
{red_flags}
If the patient describes one, write [[ESCALATE:<id>]] (e.g. [[ESCALATE:chest_pain]]) and tell them their care team will be informed today.
For anything urgent (severe chest pain, severe breathlessness, fainting, signs of stroke, very high sugar with confusion) tell them clearly to call 108 or go to the nearest emergency room now.

RULES
- Never diagnose, never change or suggest doses, never recommend new medicines. Defer to their doctor.
- Be kind and non-judgemental, especially about missed doses.
- Use what you remember from earlier calls naturally (their medicines, routine, personal details) so they do not have to repeat themselves. Never read the notes out as a list.
- If the patient is not {patient.first_name}, do not share any health details; ask when {patient.first_name} can be reached and end the call.

TOKENS (the patient never hears these)
- [[ESCALATE:<id>]] — a warning sign was reported.
- [[APPOINTMENT_REQUESTED]] — the patient wants an appointment.
- [[END_CALL]] — put this at the very end of your final goodbye reply.

SPEAKING STYLE
- Speak naturally in English. Keep each reply to one to three short sentences.
- Ask one question at a time. No lists, no markdown, no emojis.
- Say "Doctor" instead of "Dr."
"""


def build_call_prompt(ctx: PatientContext, purpose: str) -> str:
    if purpose == "feedback":
        return build_feedback_prompt(ctx)
    if ctx.protocol:
        return build_system_prompt(patient=ctx.patient, care_plan=ctx.care_plan, protocol=ctx.protocol)
    return f"You are a friendly health coach calling {ctx.patient.first_name}."


class PatientCallSession(CallSession):
    """CallSession that records warning-sign and appointment tokens and stores turns."""

    def __init__(self, websocket, call_sid: str, outreach_call: OutreachCall, ctx: PatientContext):
        super().__init__(websocket, call_sid)
        self.outreach_call = outreach_call
        self.ctx = ctx
        self.purpose = outreach_call.purpose or "checkin"
        self.escalations: List[str] = []
        self.appointment_requested = False
        self._token_buffer = ""

    async def add_turn(self, role: str, content: str) -> None:
        self.conversation_history.append({"role": role, "content": content})
        self.transcript_text += f"{role.upper()}: {content}\n"
        if self.db:
            self.db.add(
                ConversationTurn(
                    outreach_call_id=self.outreach_call.id,
                    role=role,
                    content=content,
                    timestamp=datetime.utcnow(),
                )
            )
            await self.db.flush()

    async def process_agent_sentence(self, sentence: str) -> str:
        # A token can be split across sentences, so buffer until it closes.
        text = self._token_buffer + (" " if self._token_buffer else "") + sentence
        if "[[" in text and "]]" not in text[text.rfind("[["):]:
            self._token_buffer = text
            return ""
        self._token_buffer = ""

        for match in ESCALATE_TOKEN_RE.finditer(text):
            reason = match.group(1).strip()
            if reason and reason not in self.escalations:
                logger.info(f"[{self.call_sid}] Warning sign flagged: {reason}")
                self.escalations.append(reason)
        if APPOINTMENT_TOKEN in text and not self.appointment_requested:
            logger.info(f"[{self.call_sid}] Appointment requested")
            self.appointment_requested = True

        return re.sub(r"\s{2,}", " ", ANY_TOKEN_RE.sub("", text)).strip()

    def greeting(self) -> str:
        if self.purpose != "feedback":
            return f"Hello {self.ctx.patient.first_name}, I'm your health coach. How are you feeling today?"
        reason = (
            f"to follow up on our last call about your {self.ctx.condition_name} and your medicines"
            if self.ctx.previous_summary
            else f"for a short follow-up on your {self.ctx.condition_name} and your medicines"
        )
        return (
            f"Hello, am I speaking with {self.ctx.patient.first_name}? "
            f"This is {settings.clinic_agent_name} calling from {settings.clinic_name} {reason}. "
            "Is this a good time to talk for a few minutes?"
        )


def _extract_json(text: str) -> dict:
    if "```json" in text:
        text = text.split("```json")[1].split("```")[0]
    elif "```" in text:
        text = text.split("```")[1].split("```")[0]
    return json.loads(text.strip())


async def summarize_feedback_call(transcript: str, ctx: PatientContext) -> dict:
    previous = (
        f"\nWHAT THE PATIENT REPORTED ON THE PREVIOUS CALL:\n{format_previous_call(ctx)}\n"
        if ctx.previous_summary
        else "\nThere was no previous call, so previous_call_followup must be [].\n"
    )
    prompt = f"""You are reviewing a phone call between a health assistant and a patient with {ctx.condition_name}.
{previous}
TRANSCRIPT:
{transcript}

Return only a JSON object with these fields:
{{
  "summary": "2-3 sentence summary of the call",
  "outcome": "feedback_collected|call_later|wrong_person|no_conversation",
  "sentiment": "positive|neutral|negative",
  "symptom_status": "stable|improving|worsening|unknown",
  "disease_feedback": "short phrase on how the patient says their condition is, or null",
  "medications": [
    {{"name": "medicine name", "taking_as_prescribed": true, "working": "yes|partly|no|unknown", "side_effects": "text or null", "missed_doses": "text or null"}}
  ],
  "medication_adherence": "excellent|good|fair|poor|unknown",
  "problems": ["problems the patient is facing"],
  "patient_queries": [
    {{"question": "what the patient asked", "answer_given": "short answer or null", "needs_doctor_followup": true}}
  ],
  "warning_signs_detected": false,
  "warning_sign_details": "description or null",
  "warning_severity": "urgent|high|null",
  "appointment_requested": false,
  "appointment_details": "text or null",
  "callback_requested_time": "when the patient asked to be called back, or null",
  "previous_call_followup": [
    {{"item": "a problem, side effect, missed-dose issue, question or appointment from the previous call", "status": "resolved|better|same|worse|still_open|not_discussed", "notes": "what the patient said now, or null"}}
  ],
  "csat_score": null
}}
previous_call_followup has one entry per item from the previous call. Use still_open for a question or appointment
that the care team has not dealt with yet, and not_discussed only when the item did not come up on this call.
csat_score is the 1-5 rating the patient gave, or null if they did not give one.
Only set warning_signs_detected to true if the patient clearly reported a concerning symptom."""
    try:
        response = claude_client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1200,
            messages=[{"role": "user", "content": prompt}],
        )
        return _extract_json(response.content[0].text)
    except (json.JSONDecodeError, anthropic.APIError, IndexError) as err:
        logger.error(f"Feedback call summary failed: {err}")
        return {}


def _history_entry(call: OutreachCall) -> dict:
    when = call.started_at or call.created_at or datetime.utcnow()
    return {
        "call_id": call.id,
        "date": when.strftime("%d %b %Y"),
        "purpose": call.purpose or "checkin",
        "summary": call.structured_summary.get("summary"),
    }


async def update_patient_memory(db: AsyncSession, call: OutreachCall, transcript: str) -> None:
    """Fold a finished call into the patient's memory, so every later call knows the full story."""
    patient = await db.get(Patient, call.patient_id)
    memory = patient.call_memory
    if call.structured_summary.get("outcome") in EMPTY_OUTCOMES:
        return

    if memory is None:
        # First time: build the memory from this patient's earlier calls as well.
        result = await db.execute(
            select(OutreachCall)
            .where(OutreachCall.patient_id == patient.id)
            .where(OutreachCall.id != call.id)
            .where(OutreachCall.structured_summary.isnot(None))
            .order_by(OutreachCall.created_at.desc())
            .limit(MEMORY_BACKFILL_CALLS)
        )
        earlier = [
            c for c in reversed(result.scalars().all())
            if c.structured_summary.get("summary") and c.structured_summary.get("outcome") not in EMPTY_OUTCOMES
        ]
        memory = {"calls_remembered": 0, "history": []}
    else:
        earlier = []

    new_calls = earlier + [call]
    calls_text = "\n\n".join(
        f"CALL #{c.id} on {_history_entry(c)['date']} ({c.purpose or 'checkin'})\n"
        f"Findings: {json.dumps(c.structured_summary)}"
        for c in new_calls
    )
    remembered = {k: v for k, v in memory.items() if k not in ("history", "calls_remembered", "updated_at", "last_call_id")}
    prompt = f"""You keep the long-term memory a health assistant uses when it phones a patient with a long-term condition.
Update the memory with the new call(s) below. Keep what is still true, move problems that are now fixed to resolved_issues,
drop questions the care team has answered, and keep it short: this is read before every call.

CURRENT MEMORY:
{json.dumps(remembered) if remembered else "(empty - this is the first memory for this patient)"}

NEW CALL(S), oldest first:
{calls_text}

TRANSCRIPT OF THE LATEST CALL:
{transcript[-6000:]}

Return only a JSON object:
{{
  "overview": "2-3 sentences: who the patient is and how their care is going overall",
  "condition_trend": "how their condition has changed across calls, or null",
  "medicines": [{{"name": "medicine", "notes": "adherence, side effects, whether it works - across calls"}}],
  "ongoing_issues": ["problems not yet resolved"],
  "resolved_issues": ["problems that were fixed, with when"],
  "open_questions": ["questions still waiting for the care team"],
  "personal_notes": ["useful personal details the patient shared: routine, family, diet, best time to call, preferences"]
}}"""
    try:
        response = claude_client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1200,
            messages=[{"role": "user", "content": prompt}],
        )
        updated = _extract_json(response.content[0].text)
    except (json.JSONDecodeError, anthropic.APIError, IndexError) as err:
        # Keep the old memory; the call still goes into the history below.
        logger.error(f"Patient memory update failed for patient {patient.id}: {err}")
        updated = remembered

    history = (memory.get("history") or []) + [_history_entry(c) for c in new_calls]
    patient.call_memory = {
        **updated,
        "history": history[-MEMORY_HISTORY_KEPT:],
        "calls_remembered": memory.get("calls_remembered", 0) + len(new_calls),
        "last_call_id": call.id,
        "updated_at": datetime.utcnow().isoformat(),
    }


async def finalize_feedback_call(
    db: AsyncSession,
    outreach_call_id: int,
    transcript: str,
    ctx: PatientContext,
    flagged: List[str],
    appointment_requested: bool,
) -> None:
    call = await db.get(OutreachCall, outreach_call_id)
    if not call:
        return

    call.transcript = transcript or call.transcript
    call.ended_at = call.ended_at or datetime.utcnow()
    if call.started_at:
        call.duration_seconds = int((call.ended_at - call.started_at).total_seconds())
    call.status = "completed"

    patient_spoke = "USER:" in transcript
    summary = await summarize_feedback_call(transcript, ctx) if patient_spoke else {}
    if not summary:
        summary = {"summary": "The patient did not respond on the call.", "outcome": "no_conversation"}
    if flagged:
        summary["flagged_during_call"] = flagged
    if ctx.previous_call_id:
        summary["previous_call_id"] = ctx.previous_call_id

    call.structured_summary = summary
    call.warning_signs_detected = bool(summary.get("warning_signs_detected") or flagged)
    call.medication_adherence_reported = summary.get("medication_adherence") or "unknown"
    csat = summary.get("csat_score")
    call.csat_score = csat if isinstance(csat, int) and 1 <= csat <= 5 else None

    if call.warning_signs_detected:
        details = summary.get("warning_sign_details") or ", ".join(flagged)
        db.add(
            EscalationCase(
                outreach_call_id=call.id,
                patient_id=call.patient_id,
                reason=f"Warning signs on feedback call: {details}",
                severity="urgent" if summary.get("warning_severity") == "urgent" else "high",
                status="open",
            )
        )

    open_queries = [
        q.get("question") for q in summary.get("patient_queries") or []
        if q.get("needs_doctor_followup") and q.get("question")
    ]
    if open_queries:
        db.add(
            EscalationCase(
                outreach_call_id=call.id,
                patient_id=call.patient_id,
                reason="Patient questions for the care team: " + "; ".join(open_queries),
                severity="medium",
                status="open",
            )
        )

    worse_items = [
        f.get("item") for f in summary.get("previous_call_followup") or []
        if f.get("status") == "worse" and f.get("item")
    ]
    if worse_items:
        db.add(
            EscalationCase(
                outreach_call_id=call.id,
                patient_id=call.patient_id,
                reason=f"Worse since the last call (#{ctx.previous_call_id}): " + "; ".join(worse_items),
                severity="medium",
                status="open",
            )
        )

    if (appointment_requested or summary.get("appointment_requested")) and ctx.care_plan:
        # The time is a placeholder until the care team confirms it with the patient.
        db.add(
            Appointment(
                patient_id=call.patient_id,
                care_plan_id=ctx.care_plan.id,
                triggering_outreach_call_id=call.id,
                physician_name=ctx.care_plan.assigned_physician_name or "To be assigned",
                scheduled_at=datetime.utcnow() + timedelta(days=1),
                status="requested",
                reason=summary.get("appointment_details") or "Requested during feedback call",
            )
        )

    if ctx.care_plan and summary.get("outcome") == "feedback_collected":
        care_plan = await db.get(CarePlan, ctx.care_plan.id)
        care_plan.last_outreach_at = datetime.utcnow()
        care_plan.next_due_date = datetime.utcnow() + timedelta(days=care_plan.followup_interval_days)

    await update_patient_memory(db, call, transcript)
    await db.commit()
    logger.info(
        f"Finalized feedback call #{outreach_call_id}: outcome={summary.get('outcome')} "
        f"warning={call.warning_signs_detected} queries={len(open_queries)}"
    )
