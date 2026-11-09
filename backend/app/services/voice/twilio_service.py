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
from datetime import datetime
from typing import Callable, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.call_log import CallLog, CallTurn
from app.services.agent.claude_service import stream_conversation
from app.services.voice.audio_utils import encode_mulaw_for_twilio
from app.services.voice.sarvam_tts_service import SarvamTTSService
from app.services.voice.stt_service import DeepgramStream

logger = logging.getLogger(__name__)

FRAME_BYTES = 160  # 20 ms of 8 kHz mu-law
MULAW_SILENCE = b"\xff"
SAMPLE_RATE = 8000
# A caller interim transcript this long interrupts the agent (shorter ones are often "mm" / noise)
BARGE_IN_MIN_WORDS = 2
# Max tokens per reply: replies are one or two short sentences (see common_prompts SPEAKING STYLE)
REPLY_MAX_TOKENS = 220
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

        self.selected_digit = "3"  # English
        self.started_at = datetime.utcnow()
        self.is_call_active = True
        self.current_turn_id = 0

        self._llm_task: Optional[asyncio.Task] = None
        self._send_lock = asyncio.Lock()
        # Loop time at which the audio already sent to the caller finishes playing
        self._play_until = 0.0
        # The last user turn, while no reply to it has been spoken yet (an early "eager" turn may be replaced)
        self._user_unanswered = False
        self._unanswered_user_row: Optional[CallTurn] = None

        # Conversation
        self.conversation_history: List[dict] = []
        self.transcript_text = ""
        self.system_prompt = ""
        self.call: Optional[CallLog] = None
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

    async def _say(self, text: str, is_current: Callable[[], bool]) -> bool:
        """Synthesise one sentence and send its audio as it arrives. False if interrupted."""
        pending = bytearray()
        stream = self.sarvam_tts.stream_tts(text, self.selected_digit, self.call_sid)
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
        """Say a fixed line (the greeting). The caller can talk over it."""
        turn = self.current_turn_id
        await self._say(text, lambda: self.is_call_active and self.current_turn_id == turn)

    # ---------- Conversation ----------

    async def add_turn(self, role: str, content: str, persist: bool = True) -> None:
        """Add a turn to the history and transcript; persist=True also saves it as a CallTurn row."""
        self.conversation_history.append({"role": role, "content": content})
        self.transcript_text += f"{role.upper()}: {content}\n"
        row: Optional[CallTurn] = None
        if persist and self.db and self.call:
            row = CallTurn(call_log_id=self.call.id, role=role, content=content, timestamp=datetime.utcnow())
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

        if not is_final:
            # The caller is talking over the agent: stop its voice now (barge-in)
            if len(text.split()) >= BARGE_IN_MIN_WORDS and (self.agent_audible or self._reply_running()):
                logger.info(f"[{self.call_sid}] Barge-in: caller started speaking")
                await self.interrupt()
            return

        self.current_turn_id += 1
        turn = self.current_turn_id
        logger.info(f"[{self.call_sid}] Patient said: {text}")

        await self.interrupt()
        if turn != self.current_turn_id:
            return  # a newer turn arrived while this one was stopping the old reply
        self.on_new_turn()
        if not self._replace_unanswered_user_turn(text):
            await self.add_turn("user", text)
        self._llm_task = asyncio.create_task(self._reply(turn))

    async def _reply(self, turn: int) -> None:
        """Stream Claude's reply sentence by sentence; each sentence is spoken as soon as it is ready."""
        def is_current() -> bool:
            return self.is_call_active and self.current_turn_id == turn

        spoken: List[str] = []
        end_call = False
        completed = False
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
                    spoken.append(text)
                    if not await self._say(text, is_current):
                        break
            else:
                completed = True

            if completed and is_current():
                tail = await self.flush_agent_text()
                if tail:
                    logger.info(f"[{self.call_sid}] Agent: {tail}")
                    spoken.append(tail)
                    await self._say(tail, is_current)
                if not spoken and not end_call:
                    # The reply had nothing to say aloud (e.g. only a hidden token): never leave dead air
                    logger.warning(f"[{self.call_sid}] Reply had no spoken text; asking the caller to repeat")
                    spoken.append(FALLBACK_REPLY)
                    await self._say(FALLBACK_REPLY, is_current)
        except asyncio.CancelledError:
            # Interrupted: keep what was already said so the agent doesn't repeat it next time
            if spoken:
                await self.add_turn("assistant", " ".join(spoken) + CUT_OFF_MARK, persist=False)
            raise
        except Exception as exc:
            logger.error(f"[{self.call_sid}] Reply error: {exc}", exc_info=True)

        if spoken or end_call:
            reply = " ".join(spoken) if completed and is_current() else " ".join(spoken) + CUT_OFF_MARK
            await self.add_turn("assistant", reply)

        if end_call and is_current():
            # Hang up only after the goodbye has finished playing
            remaining = self._play_until - self._now()
            await asyncio.sleep(max(0.0, remaining) + 0.5)
            if is_current():
                logger.info(f"[{self.call_sid}] Ending call after goodbye")
                self.is_call_active = False

    async def close(self) -> None:
        """Clean up the session."""
        self.is_call_active = False
        if self._llm_task and not self._llm_task.done():
            self._llm_task.cancel()
            await asyncio.wait({self._llm_task}, timeout=1.0)
        if self.deepgram_stt:
            await self.deepgram_stt.stop()
        if self.sarvam_tts:
            await self.sarvam_tts.close(call_sid=self.call_sid)
        if self.db:
            await self.db.commit()
