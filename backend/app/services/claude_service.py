import anthropic
import json
import logging
from typing import Optional, List, Tuple
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()
client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

logger.info(f"🤖 Claude API initialized with key: {settings.anthropic_api_key[:20]}...")


async def stream_conversation(
    system_prompt: str,
    conversation_history: List[dict],
    max_tokens: int = 200,
) -> Tuple[str, str]:
    """Stream a response from Claude for real-time voice conversation.

    Args:
        system_prompt: The system prompt defining the agent's role and behavior
        conversation_history: List of {"role": "user|assistant", "content": "..."} dicts
        max_tokens: Maximum tokens for the response

    Returns:
        (full_response, sentence_queue) where sentence_queue is text ready for TTS
    """
    logger.info(f"🗣️ Claude stream_conversation called with {len(conversation_history)} messages")
    logger.info(f"📝 System prompt: {system_prompt[:200]}...")

    full_response = ""
    sentence_buffer = ""

    try:
        logger.info(f"📤 Calling Claude API...")
        with client.messages.stream(
            model="claude-sonnet-5",
            max_tokens=max_tokens,
            system=system_prompt,
            messages=conversation_history,
        ) as stream:
            logger.info(f"✅ Claude stream opened")
            for text in stream.text_stream:
                full_response += text
                sentence_buffer += text

                # Yield complete sentences (ending with . ! or ?) for TTS
                while True:
                    match = None
                    for i, char in enumerate(sentence_buffer):
                        if char in ".!?":
                            match = i
                            break

                    if match is not None:
                        sentence = sentence_buffer[: match + 1].strip()
                        sentence_buffer = sentence_buffer[match + 1 :].strip()
                        if sentence:
                            yield sentence
                    else:
                        break

        # Yield any remaining text
        if sentence_buffer.strip():
            yield sentence_buffer.strip()

    except anthropic.APIError as e:
        print(f"Claude API error: {e}")
        raise


async def finalize_call_summary(
    transcript: str,
    system_context: str,
) -> dict:
    """Extract structured summary from call transcript using Claude.

    Args:
        transcript: Full conversation transcript
        system_context: Context about patient, condition, protocol

    Returns:
        Dictionary with: summary, sentiment, symptom_status, medication_adherence,
        warning_signs_detected, warning_sign_details, appointment_requested, csat_score
    """

    extraction_prompt = f"""You are analyzing a health coaching call transcript. Extract structured information.

{system_context}

TRANSCRIPT:
{transcript}

Return a JSON object with exactly these fields:
{{
  "summary": "2-3 sentence summary of the call",
  "sentiment": "positive|neutral|negative",
  "symptom_status": "stable|worsening|improving|unknown",
  "medication_adherence": "excellent|good|fair|poor|unknown",
  "warning_signs_detected": true|false,
  "warning_sign_details": "description of red flags or null",
  "appointment_requested": true|false,
  "appointment_details": "details about appointment request or null",
  "csat_score": 1-5 or null
}}

Be conservative: only set warning_signs_detected=true if the patient clearly reported concerning symptoms.
"""

    try:
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=500,
            messages=[{"role": "user", "content": extraction_prompt}],
        )

        response_text = response.content[0].text
        # Extract JSON from response (handle markdown code blocks)
        if "```json" in response_text:
            json_str = response_text.split("```json")[1].split("```")[0].strip()
        elif "```" in response_text:
            json_str = response_text.split("```")[1].split("```")[0].strip()
        else:
            json_str = response_text.strip()

        return json.loads(json_str)

    except (json.JSONDecodeError, anthropic.APIError, IndexError) as e:
        print(f"Error finalizing call: {e}")
        return {
            "summary": "Unable to process transcript",
            "sentiment": "unknown",
            "symptom_status": "unknown",
            "medication_adherence": "unknown",
            "warning_signs_detected": False,
            "warning_sign_details": None,
            "appointment_requested": False,
            "appointment_details": None,
            "csat_score": None,
        }
