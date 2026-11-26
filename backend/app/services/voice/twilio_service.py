"""One live voice call: caller audio in (Deepgram STT), agent replies out (Claude -> Sarvam TTS).

Audio is sent to the caller directly as it is synthesised, with no queue and no sleep-based pacing:
Twilio (or the direct browser test) buffers and plays it in real time. Pacing with
asyncio.sleep(0.02) per 20 ms frame under-ran on Windows (timer steps of ~15.6 ms make each
sleep ~31 ms), which caused choppy, crackling audio.

Barge-in: when the caller starts talking over the agent, the reply is cancelled and Twilio is told
to "clear" the audio it has buffered but not yet played. Whatever the agent had already said is
kept in the conversation history (marked as cut off), so it doesn't start the same reply over.
"""
import asyncio
import logging
import re
from datetime import datetime
from typing import Callable, List, Optional, Tuple

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.call_log import CallLog, CallTurn
from app.services.agent.claude_service import stream_conversation
from app.services.voice.audio_utils import encode_mulaw_for_twilio
from app.services.voice.sarvam_tts_service import SarvamTTSService
from app.services.voice.stt_service import DeepgramStream

logger = logging.getLogger(__name__)

FRAME_BYTES = 160  # 20 ms of 8 kHz mu-law
MULAW_SILENCE = b"\xff"
SAMPLE_RATE = 8000
DIGIT_GAP_SECONDS = 1.0  # pause between spoken digits of a phone number
# A lone digit sent to the TTS can be read as a decimal ("0.9"), so each digit is sent as a word.
# Keys are the voice digits: 1 = Telugu, 2 = Hindi, 3 = English.
DIGIT_WORDS = {
    "3": ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"],
    "2": ["शून्य", "एक", "दो", "तीन", "चार", "पाँच", "छह", "सात", "आठ", "नौ"],
    "1": ["సున్నా", "ఒకటి", "రెండు", "మూడు", "నాలుగు", "ఐదు", "ఆరు", "ఏడు", "ఎనిమిది", "తొమ్మిది"],
}
DIGIT_RUN = re.compile(r"\d(?:[\s\-,.]?\d){3,}")  # 4+ digits, possibly written "98765 43210" or "9 8 7 6"
# A caller interim transcript this long interrupts the agent (shorter ones are often "mm" / noise)
BARGE_IN_MIN_WORDS = 2
# Max tokens per reply. Replies are short, but one reply can also carry hidden tokens (an appointment
# request) and the [[END_CALL]] at the very end, which must never be cut off.
REPLY_MAX_TOKENS = 500

# Lines the system says by itself (silence, very long call), in the call's language
STILL_THERE_LINES = {
    "en": "Are you still there?",
    "hi": "क्या आप अभी लाइन पर हैं?",
    "te": "మీరు ఇంకా లైన్‌లో ఉన్నారా?",
}
SILENCE_GOODBYE_LINES = {
    "en": "I'll end the call now. Thank you for calling. Goodbye!",
    "hi": "मैं अब call समाप्त कर रही हूँ। call करने के लिए धन्यवाद। नमस्ते!",
    "te": "నేను ఇప్పుడు call ముగిస్తున్నాను. call చేసినందుకు ధన్యవాదాలు.",
}
LONG_CALL_GOODBYE_LINES = {
    "en": "I'm sorry, we have been on the call for a long time. Our clinic team will call you back if you need more help. Goodbye!",
    "hi": "माफ़ कीजिए, call काफ़ी लंबी हो गई है। अगर और मदद चाहिए तो हमारी clinic team आपको वापस call करेगी। नमस्ते!",
    "te": "క్షమించండి, call చాలా సేపు అయింది. ఇంకా సహాయం కావాలంటే మా clinic team మీకు తిరిగి call చేస్తారు. ధన్యవాదాలు.",
}
# A reply that clearly says goodbye ends the call even if the model forgot [[END_CALL]]
GOODBYE_RE = re.compile(r"\b(good\s?-?bye|bye)\b|अलविदा|नमस्ते\s*[।!.]?\s*$|వీడ్కోలు|సెలవు", re.IGNORECASE)


def looks_like_goodbye(text: str) -> bool:
    """True for a final sentence like "Thank you for calling, goodbye!" (never for a question)."""
    text = text.strip()
    return bool(text) and not text.endswith("?") and bool(GOODBYE_RE.search(text))
# Marks a reply the caller talked over, in the history the model sees
CUT_OFF_MARK = " …(cut off: the caller started speaking)"
FALLBACK_REPLY = "Sorry, could you say that again?"


class CallSession:
    """Manages a single voice call session."""

    def __init__(self, websocket, call_sid: str):
        self.ws = websocket
        self.call_sid = call_sid
        self.stream_sid: Optional[str] = None
        self.deepgram_stt: Optional[DeepgramStream] = None
        self.sarvam_tts = SarvamTTSService()
        # SarvamTTSService is PlivoTTSService when TTS_PROVIDER=plivo (see sarvam_tts_service.py)
        tts_name = "Plivo" if type(self.sarvam_tts).__name__ == "PlivoTTSService" else "Sarvam"
        logger.info(f"[{call_sid}] Agent voice: {tts_name}")

        self.selected_digit = "3"  # voice language (3 = English); the agent session sets it per call
        self.language: Optional[str] = None  # en | hi | te, for the lines the system says by itself
        self.started_at = datetime.utcnow()
        self.is_call_active = True
        self.current_turn_id = 0

        # Silence and call-length watchdog (see _watchdog_loop)
        self._last_activity = 0.0  # loop time the caller last spoke (or the watchdog started)
        self._silence_stage = 0  # 0 = normal, 1 = asked "Are you still there?"
        self._system_speaking = False
        self._watchdog: Optional[asyncio.Task] = None

        self._llm_task: Optional[asyncio.Task] = None
        self._send_lock = asyncio.Lock()
        # Loop time at which the audio already sent to the caller finishes playing
        self._play_until = 0.0
        # The last user turn, while no reply to it has been spoken yet (an early "eager" turn may be replaced)
        self._user_unanswered = False
        self._unanswered_user_row: Optional[CallTurn] = None
        # When the caller started the sentence that is being heard now (first words from speech recognition)
        self._caller_started: Optional[datetime] = None

        # Conversation
        self.conversation_history: List[dict] = []
        self.transcript_text = ""
        self.system_prompt = ""
        self.call: Optional[CallLog] = None
        # The call's id, kept as a plain number so saving a turn never needs the database to re-read the call
        self.call_id: Optional[int] = None
        self.db: Optional[AsyncSession] = None

    # ---------- Hooks for subclasses (CallAgentSession) ----------

    async def process_agent_sentence(self, sentence: str) -> str:
        """Act on control tokens in a sentence. Returns the text to speak."""
        return sentence

    async def flush_agent_text(self) -> str:
        """Text held back at the end of a reply (e.g. an unfinished token). Returns what can be spoken."""
        return ""

    def on_new_turn(self) -> None:
        """Called when the caller starts a new turn (reset per-reply state)."""

    async def on_reply_done(self, completed: bool) -> None:
        """Called after each agent reply has been spoken (completed=False if it was interrupted)."""

    async def on_auto_end(self, reason: str) -> None:
        """Called when the system ends the call by itself: reason "silence" or "max_duration"."""

    # ---------- Audio out ----------

    def _now(self) -> float:
        return asyncio.get_running_loop().time()

    @property
    def agent_audible(self) -> bool:
        """True while audio already sent to the caller is still playing."""
        return self._play_until > self._now()

    def _reply_running(self) -> bool:
        return bool(self._llm_task and not self._llm_task.done())

    async def send_audio_to_caller(self, mulaw_bytes: bytes) -> None:
        """Send audio straight to the caller (Twilio buffers and plays it in real time)."""
        if not self.stream_sid or not self.is_call_active or not mulaw_bytes:
            return
        async with self._send_lock:
            try:
                await self.ws.send_json({
                    "event": "media",
                    "streamSid": self.stream_sid,
                    "media": {"payload": encode_mulaw_for_twilio(mulaw_bytes)},
                })
            except Exception:
                return
        now = self._now()
        self._play_until = max(self._play_until, now) + len(mulaw_bytes) / SAMPLE_RATE

    async def clear_caller_audio(self) -> None:
        """Barge-in: drop the agent audio the caller hasn't heard yet."""
        self._play_until = 0.0
        if not self.stream_sid:
            return
        async with self._send_lock:
            try:
                await self.ws.send_json({"event": "clear", "streamSid": self.stream_sid})
            except Exception:
                pass

    async def _say(self, text: str, is_current: Callable[[], bool], digit: Optional[str] = None) -> bool:
        """Say one sentence. Phone-like digit runs (4+ digits) are spoken one digit at a time with a
        DIGIT_GAP_SECONDS pause between digits so the caller can write them down. False if interrupted."""
        pos = 0
        for match in DIGIT_RUN.finditer(text):
            before = text[pos:match.start()]
            if before.strip() and not await self._say_chunk(before, is_current, digit):
                return False
            digits = re.sub(r"\D", "", match.group())
            for i, d in enumerate(digits):
                words = DIGIT_WORDS.get(digit or self.selected_digit, DIGIT_WORDS["3"])
                if not await self._say_chunk(words[int(d)], is_current, digit):
                    return False
                if i < len(digits) - 1 and not await self._pause(DIGIT_GAP_SECONDS, is_current):
                    return False
            pos = match.end()
        rest = text[pos:]
        if rest.strip():
            return await self._say_chunk(rest, is_current, digit)
        return is_current()

    async def _pause(self, seconds: float, is_current: Callable[[], bool]) -> bool:
        """Send silence to the caller (counts as playing time, so barge-in handling stays correct)."""
        if not is_current():
            return False
        await self.send_audio_to_caller(MULAW_SILENCE * int(seconds * SAMPLE_RATE))
        return is_current()

    async def _say_chunk(self, text: str, is_current: Callable[[], bool], digit: Optional[str] = None) -> bool:
        """Synthesise one piece of text and send its audio as it arrives. False if interrupted.

        digit picks the voice language (see SarvamTTSService); default: the call's language.
        """
        pending = bytearray()
        stream = self.sarvam_tts.stream_tts(text, digit or self.selected_digit, self.call_sid)
        try:
            async for chunk in stream:
                if not is_current():
                    return False
                pending.extend(chunk)
                whole = len(pending) - len(pending) % FRAME_BYTES
                if whole:
                    await self.send_audio_to_caller(bytes(pending[:whole]))
                    del pending[:whole]
        except Exception as exc:
            logger.error(f"[{self.call_sid}] TTS error: {exc}")
            return is_current()
        finally:
            await stream.aclose()
        if pending and is_current():
            # Pad the last partial frame with silence instead of dropping it (a dropped tail clicks)
            pending.extend(MULAW_SILENCE * (FRAME_BYTES - len(pending)))
            await self.send_audio_to_caller(bytes(pending))
        return is_current()

    async def speak(self, text: str) -> None:
        """Say a fixed line. The caller can talk over it."""
        turn = self.current_turn_id
        await self._say(text, lambda: self.is_call_active and self.current_turn_id == turn)

    async def speak_parts(self, parts: List[Tuple[str, str]]) -> None:
        """Say a fixed line made of (text, voice digit) parts, e.g. a greeting in three languages."""
        turn = self.current_turn_id

        def is_current() -> bool:
            return self.is_call_active and self.current_turn_id == turn

        for text, digit in parts:
            if not is_current() or not await self._say(text, is_current, digit):
                return

    # ---------- Conversation ----------

    async def add_turn(self, role: str, content: str, persist: bool = True, at: Optional[datetime] = None) -> None:
        """Add a turn to the history and transcript; persist=True also saves it as a CallTurn row.

        at: when the line STARTED being spoken (UTC, our server clock); default now. The transcript
        shows each line at this time, counted from the start of the call.
        """
        self.conversation_history.append({"role": role, "content": content})
        self.transcript_text += f"{role.upper()}: {content}\n"
        row: Optional[CallTurn] = None
        if persist and self.db and self.call_id:
            row = CallTurn(call_log_id=self.call_id, role=role, content=content, timestamp=at or datetime.utcnow())
            self.db.add(row)
            await self.db.flush()
        self._user_unanswered = role == "user"
        self._unanswered_user_row = row if role == "user" else None

    def _replace_unanswered_user_turn(self, text: str) -> bool:
        """An early ("eager") turn was replaced by the full one before any reply: update it in place."""
        if not self._user_unanswered or not self.conversation_history or self.conversation_history[-1]["role"] != "user":
            return False
        old = self.conversation_history[-1]["content"]

        def words(value: str) -> List[str]:
            return "".join(c.lower() if c.isalnum() else " " for c in value).split()

        # Only when the new text continues the old one (eager "Can I take" -> final "Can I take two?")
        if words(text)[: len(words(old))] != words(old):
            return False
        self.conversation_history[-1]["content"] = text
        old_line = f"USER: {old}\n"
        if self.transcript_text.endswith(old_line):
            self.transcript_text = self.transcript_text[: -len(old_line)] + f"USER: {text}\n"
        if self._unanswered_user_row is not None:
            self._unanswered_user_row.content = text
        return True

    async def interrupt(self) -> None:
        """Stop the agent: cancel the reply in progress and drop its unplayed audio."""
        task = self._llm_task
        if task and not task.done():
            task.cancel()
            await asyncio.wait({task}, timeout=1.0)
        if self._play_until > 0:
            await self.clear_caller_audio()

    async def handle_transcript(self, text: str, is_final: bool) -> None:
        """Caller speech from STT. Interim text can interrupt the agent; final text starts a reply."""
        if not self.is_call_active or not text:
            return

        # The caller is talking: not silent any more
        self._last_activity = self._now()
        self._silence_stage = 0

        if not is_final:
            # First words of a new sentence: remember when the caller started speaking
            if self._caller_started is None:
                self._caller_started = datetime.utcnow()
            # The caller is talking over the agent: stop its voice now (barge-in)
            if len(text.split()) >= BARGE_IN_MIN_WORDS and (self.agent_audible or self._reply_running()):
                logger.info(f"[{self.call_sid}] Barge-in: caller started speaking")
                await self.interrupt()
            return

        self.current_turn_id += 1
        turn = self.current_turn_id
        logger.info(f"[{self.call_sid}] Patient said: {text}")
        # The line is timed from when the caller started speaking (or now, if no early words came in);
        # a leftover start from noise long ago is ignored
        now = datetime.utcnow()
        started = self._caller_started if self._caller_started and (now - self._caller_started).total_seconds() < 30 else now
        self._caller_started = None

        await self.interrupt()
        if turn != self.current_turn_id:
            return  # a newer turn arrived while this one was stopping the old reply
        self.on_new_turn()
        if not self._replace_unanswered_user_turn(text):
            await self.add_turn("user", text, at=started)
        self._llm_task = asyncio.create_task(self._reply(turn))

    async def _reply(self, turn: int) -> None:
        """Stream Claude's reply sentence by sentence; each sentence is spoken as soon as it is ready."""
        def is_current() -> bool:
            return self.is_call_active and self.current_turn_id == turn

        spoken: List[str] = []
        end_call = False
        completed = False
        started: Optional[datetime] = None  # when the agent began speaking this reply
        try:
            async for sentence in stream_conversation(
                system_prompt=self.system_prompt,
                conversation_history=list(self.conversation_history),
                max_tokens=REPLY_MAX_TOKENS,
            ):
                if not is_current():
                    break
                text = await self.process_agent_sentence(sentence)
                if "[[END_CALL]]" in text:
                    end_call = True
                    text = text.replace("[[END_CALL]]", "").strip()
                if text:
                    logger.info(f"[{self.call_sid}] Agent: {text}")
                    started = started or datetime.utcnow()
                    spoken.append(text)
                    if not await self._say(text, is_current):
                        break
            else:
                completed = True

            if completed and is_current():
                tail = await self.flush_agent_text()
                if tail:
                    logger.info(f"[{self.call_sid}] Agent: {tail}")
                    started = started or datetime.utcnow()
                    spoken.append(tail)
                    await self._say(tail, is_current)
                if not spoken and not end_call:
                    # The reply had nothing to say aloud (e.g. only a hidden token): never leave dead air
                    logger.warning(f"[{self.call_sid}] Reply had no spoken text; asking the caller to repeat")
                    started = started or datetime.utcnow()
                    spoken.append(FALLBACK_REPLY)
                    await self._say(FALLBACK_REPLY, is_current)
                if spoken and not end_call and looks_like_goodbye(spoken[-1]):
                    # The agent said goodbye but forgot [[END_CALL]]: end the call anyway
                    logger.info(f"[{self.call_sid}] Reply ends with a goodbye but no [[END_CALL]]; ending the call")
                    end_call = True
        except asyncio.CancelledError:
            # Interrupted: keep what was already said (the caller heard it), so the transcript is complete
            # and the agent doesn't repeat it next time
            if spoken:
                await self.add_turn("assistant", " ".join(spoken) + CUT_OFF_MARK, at=started)
            raise
        except Exception as exc:
            logger.error(f"[{self.call_sid}] Reply error: {exc}", exc_info=True)

        if spoken or end_call:
            reply = " ".join(spoken) if completed and is_current() else " ".join(spoken) + CUT_OFF_MARK
            await self.add_turn("assistant", reply, at=started)

        try:
            await self.on_reply_done(completed and is_current())
        except Exception as exc:
            logger.error(f"[{self.call_sid}] After-reply step failed: {exc}", exc_info=True)

        if end_call and is_current():
            # Hang up only after the goodbye has finished playing
            remaining = self._play_until - self._now()
            await asyncio.sleep(max(0.0, remaining) + 0.5)
            if is_current():
                logger.info(f"[{self.call_sid}] Ending call after goodbye")
                self.is_call_active = False

    # ---------- Silence and call-length watchdog ----------

    def start_watchdog(self) -> None:
        """Start watching for a silent caller and a call that runs too long (after the greeting starts)."""
        if self._watchdog is None:
            self._last_activity = self._now()
            self._watchdog = asyncio.create_task(self._watchdog_loop())

    def _line(self, lines: dict) -> str:
        return lines.get(self.language or "en", lines["en"])

    async def _say_system_line(self, text: str) -> None:
        """Say a line the system chose (not the model), and keep it in the transcript."""
        self._system_speaking = True
        try:
            await self.add_turn("assistant", text)
            if self.db:
                await self.db.commit()
            await self.speak(text)
        finally:
            self._system_speaking = False

    async def _end_by_system(self, lines: dict, reason: str) -> None:
        """Say goodbye and hang up. A silence hang-up is cancelled if the caller speaks during it."""
        logger.info(f"[{self.call_sid}] Ending the call: {reason}")
        await self._say_system_line(self._line(lines))
        await asyncio.sleep(max(0.0, self._play_until - self._now()) + 0.5)
        if reason == "silence" and self._silence_stage == 0:
            logger.info(f"[{self.call_sid}] Caller spoke during the goodbye; keeping the call open")
            return
        try:
            await self.on_auto_end(reason)
        except Exception as exc:
            logger.error(f"[{self.call_sid}] Auto-end step failed: {exc}", exc_info=True)
        self.is_call_active = False

    async def _watchdog_loop(self) -> None:
        settings = get_settings()
        reprompt = max(3, settings.silence_reprompt_seconds)
        hangup = max(3, settings.silence_hangup_seconds)
        max_seconds = settings.max_call_minutes * 60
        try:
            while self.is_call_active:
                await asyncio.sleep(1.0)
                if not self.is_call_active:
                    return
                # 1. Nobody's call lasts for ever
                if max_seconds and (datetime.utcnow() - self.started_at).total_seconds() >= max_seconds:
                    await self.interrupt()
                    await self._end_by_system(LONG_CALL_GOODBYE_LINES, "max_duration")
                    return
                # 2. Silence: only counted while nobody is speaking and no reply is being prepared
                if self._reply_running() or self.agent_audible or self._system_speaking:
                    continue
                idle = self._now() - max(self._last_activity, self._play_until)
                if self._silence_stage == 0 and idle >= reprompt:
                    self._silence_stage = 1
                    logger.info(f"[{self.call_sid}] Caller silent for {int(idle)}s; asking if they are still there")
                    await self._say_system_line(self._line(STILL_THERE_LINES))
                elif self._silence_stage == 1 and idle >= hangup:
                    await self._end_by_system(SILENCE_GOODBYE_LINES, "silence")
                    if not self.is_call_active:
                        return
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.error(f"[{self.call_sid}] Watchdog error: {exc}", exc_info=True)

    async def close(self) -> None:
        """Clean up the session."""
        self.is_call_active = False
        if self._watchdog and not self._watchdog.done():
            self._watchdog.cancel()
        if self._llm_task and not self._llm_task.done():
            self._llm_task.cancel()
            await asyncio.wait({self._llm_task}, timeout=1.0)
        if self.deepgram_stt:
            await self.deepgram_stt.stop()
        if self.sarvam_tts:
            await self.sarvam_tts.close(call_sid=self.call_sid)
        if self.db:
            await self.db.commit()
