import anthropic
import json
import logging
from typing import AsyncGenerator, List, Optional
from app.config import get_settings
from app.prompts.common_prompts import CALL_SUMMARY_PROMPT

logger = logging.getLogger(__name__)
settings = get_settings()
# Async client: streaming must never block the event loop (a blocked loop stops caller audio
# being sent and received mid-reply, which is heard as choppy audio and missed interruptions)
client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

LIVE_MODEL = "claude-sonnet-5"
SUMMARY_MODEL = "claude-haiku-4-5-20251001"


# Words ending in "." that do not end a sentence ("Dr. Rao", "10 a.m. tomorrow")
_ABBREVIATIONS = {"dr", "mr", "mrs", "ms", "st", "vs", "e.g", "i.e", "a.m", "p.m", "approx"}


def _sentence_end(buffer: str) -> Optional[int]:
    """Index of the first sentence-ending ".", "!", "?" or Hindi "।" in buffer; None if there is none yet.

    A "." only counts once the next character (a space) has arrived and the word before it is not
    an abbreviation, so "Dr. Rao" and "120.5" are not cut in two.
    """
    for i, char in enumerate(buffer):
        if char in "!?।":
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
) -> AsyncGenerator[str, None]:
    """Stream Claude's reply for a live call, yielding one complete sentence at a time for TTS.

    Args:
        system_prompt: The system prompt defining the agent's role and behavior
        conversation_history: List of {"role": "user|assistant", "content": "..."} dicts
        max_tokens: Maximum tokens for the response
    """
    logger.debug(f"Claude reply requested ({len(conversation_history)} messages)")
    sentence_buffer = ""

    try:
        async with client.messages.stream(
            model=LIVE_MODEL,
            max_tokens=max_tokens,
            system=system_prompt,
            messages=conversation_history,
        ) as stream:
            async for text in stream.text_stream:
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
            try:
                final = await stream.get_final_message()
                if final.stop_reason == "max_tokens":
                    logger.warning(
                        f"Reply was cut off at the {max_tokens}-token limit; the end of it (and any [[END_CALL]]) was lost"
                    )
            except Exception:
                pass

        # Yield any remaining text
        if sentence_buffer.strip():
            yield sentence_buffer.strip()

    except anthropic.APIError as e:
        logger.error(f"Claude API error: {e}")
        raise


async def finalize_call_summary(transcript: str, system_context: str) -> dict:
    """The structured call record (see CALL_SUMMARY_PROMPT) extracted from the transcript.

    Returns {} if the summary could not be made, so the call is still saved.
    """
    extraction_prompt = CALL_SUMMARY_PROMPT.format(
        org_name=settings.clinic_name, system_context=system_context, transcript=transcript
    )
    try:
        response = await client.messages.create(
            model=SUMMARY_MODEL,
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
        data = json.loads(json_str)
        return data if isinstance(data, dict) else {}
    except Exception as e:  # any failure (API, auth, bad JSON) must not stop the call being saved
        logger.error(f"Call summary failed, saving the call without one: {e}")
        return {}
