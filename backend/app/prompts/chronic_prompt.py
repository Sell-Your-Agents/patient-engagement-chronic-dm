from app.config import get_settings
from app.models.disease_protocol import DiseaseProtocol
from app.models.patient import Patient
from app.models.plan import Plan
from app.prompts.outbound_prompts import APPOINTMENT_RULE_REQUEST, CHRONIC_SYSTEM_PROMPT
from app.services.agent.context_shared import full_name, now_text, physician_spoken, red_flag_lines

settings = get_settings()


def build_system_prompt(patient: Patient, plan: Plan, protocol: DiseaseProtocol) -> str:
    """Fill the chronic-care check-in prompt (outbound_prompts.CHRONIC_SYSTEM_PROMPT).

    The prompt is data-driven: assessment questions, red flags (always with their ids) and
    education points come from the DiseaseProtocol row, not hardcoded. The protocol's
    escalation_instructions are staff text and are never put in front of the patient.
    """
    name = full_name(patient)

    assessment_text = "\n".join(
        f"  - {q['text']}" for q in (protocol.assessment_questions or []) if isinstance(q, dict) and q.get("text")
    ) or "  - How have you been feeling since the last check-in?"
    education_text = "\n".join(
        f"  - {point}" for point in (protocol.education_talking_points or []) if point
    ) or "  - (no health tips listed; skip this step)"

    condition_name = "your condition"
    if plan.patient_condition and plan.patient_condition.chronic_condition:
        condition_name = plan.patient_condition.chronic_condition.display_name

    if plan.followup_interval_minutes:
        followup_interval = f"every {plan.followup_interval_minutes} minutes"
    else:
        followup_interval = f"every {plan.followup_interval_days} days"
    last_outreach = (
        plan.last_outreach_at.strftime("%d %B %Y") if plan.last_outreach_at else "this is the first check-in call"
    )

    return CHRONIC_SYSTEM_PROMPT.format(
        agent_name=settings.clinic_agent_name,
        org_name=settings.clinic_name,
        now=now_text(),
        full_name=name,
        first_name=patient.first_name,
        condition_name=condition_name,
        physician=plan.assigned_physician_name or "not assigned",
        physician_spoken=physician_spoken(plan.assigned_physician_name),
        last_outreach=last_outreach,
        followup_interval=followup_interval,
        assessment_text=assessment_text,
        red_flag_text=red_flag_lines(protocol),
        education_text=education_text,
        appointment_rule=APPOINTMENT_RULE_REQUEST,
    )
