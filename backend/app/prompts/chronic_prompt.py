from app.models.patient import Patient
from app.models.plan import Plan
from app.models.disease_protocol import DiseaseProtocol
from app.prompts.prompts import CHRONIC_SYSTEM_PROMPT


def build_system_prompt(
    patient: Patient,
    plan: Plan,
    protocol: DiseaseProtocol,
    agent_name: str = "HealthCoach",
    org_name: str = "Patient Engagement Center",
) -> str:
    """Fill the chronic-care check-in prompt (Part A in prompts.py) for the health coaching conversation.

    The prompt is data-driven: assessment questions, red-flag criteria, education points,
    and medication classes are pulled from the DiseaseProtocol JSON, not hardcoded.
    """

    # Extract protocol data
    assessment_questions = protocol.assessment_questions or []
    red_flag_criteria = protocol.red_flag_criteria or []
    education_points = protocol.education_talking_points or []
    medication_classes = protocol.medication_classes or []
    escalation_instructions = protocol.escalation_instructions or ""

    # Format assessment questions for the prompt
    assessment_text = "\n".join(
        f"  - {q['text']}" for q in assessment_questions if "text" in q
    )

    # Format red flag criteria
    red_flag_text = "\n".join(
        f"  - {c['description']} (severity: {c.get('severity', 'unknown')})"
        for c in red_flag_criteria
        if "description" in c
    )

    # Format education talking points
    education_text = "\n".join(f"  - {point}" for point in education_points)

    # Format medication classes
    medication_text = ", ".join(medication_classes) if medication_classes else "N/A"

    # Get condition name
    condition_name = "Unknown"
    if plan and plan.patient_condition:
        condition_name = plan.patient_condition.chronic_condition.display_name

    last_outreach = plan.last_outreach_at.strftime('%B %d, %Y') if plan.last_outreach_at else 'First contact'

    return CHRONIC_SYSTEM_PROMPT.format(
        agent_name=agent_name,
        org_name=org_name,
        first_name=patient.first_name,
        last_name=patient.last_name,
        preferred_language=patient.preferred_language,
        phone_number=patient.phone_number,
        condition_name=condition_name,
        physician=plan.assigned_physician_name,
        last_outreach=last_outreach,
        followup_interval_days=plan.followup_interval_days,
        assessment_text=assessment_text,
        medication_text=medication_text,
        education_text=education_text,
        red_flag_text=red_flag_text,
        escalation_instructions=escalation_instructions,
    )
