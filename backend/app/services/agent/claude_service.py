import anthropic
import json
import logging
from typing import List, Optional, Tuple
from app.config import get_settings
from app.prompts.prompts import CALL_SUMMARY_PROMPT

logger = logging.getLogger(__name__)
settings = get_settings()
client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

logger.info(f"🤖 Claude API initialized with key: {settings.anthropic_api_key[:20]}...")


# Words ending in "." that do not end a sentence ("Dr. Rao", "10 a.m. tomorrow")
_ABBREVIATIONS = {"dr", "mr", "mrs", "ms", "st", "vs", "e.g", "i.e", "a.m", "p.m", "approx"}


def _sentence_end(buffer: str) -> Optional[int]:
    """Index of the first sentence-ending ".", "!" or "?" in buffer; None if there is none yet.

    A "." only counts once the next character (a space) has arrived and the word before it is not
    an abbreviation, so "Dr. Rao" and "120.5" are not cut in two.
    """
    for i, char in enumerate(buffer):
        if char in "!?":
            return i
        if char != ".":
            continue
        if i + 1 >= len(buffer):
            return None  # wait for the next text
        if not buffer[i + 1].isspace():
            continue
        words = buffer[:i].split()
        if words and words[-1].strip("(\"'").lower() in _ABBREVIATIONS:
            continue
        return i
    return None


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
                    match = _sentence_end(sentence_buffer)
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

    extraction_prompt = CALL_SUMMARY_PROMPT.format(system_context=system_context, transcript=transcript)

    try:
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=900,
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
            "patient_name": None,
            "reason": None,
            "symptoms": [],
            "urgency": None,
            "outcome": None,
            "summary": "Unable to process transcript",
            "sentiment": "unknown",
            "symptom_status": "unknown",
            "medication_adherence": "unknown",
            "warning_signs_detected": False,
            "warning_sign_details": None,
            "appointment_requested": False,
            "appointment_details": None,
            "callback_requested": False,
            "callback_time": None,
            "callback_reason": None,
            "csat_score": None,
        }
