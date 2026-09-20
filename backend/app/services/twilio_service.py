import asyncio
import json
import base64
import re
import time
from datetime import datetime
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.outreach_call import OutreachCall, ConversationTurn
from app.services.stt_service import SarvamStream
from app.services.sarvam_tts_service import SarvamTTSService
from app.services.claude_service import stream_conversation
from app.services.audio_utils import encode_mulaw_for_twilio
import logging

logger = logging.getLogger(__name__)


class CallSession:
    """Manages a single voice call session - matches reference app architecture."""

    def __init__(self, websocket, call_sid: str):
        self.ws = websocket
        self.call_sid = call_sid
        self.stream_sid: Optional[str] = None
        self.sarvam_stt: Optional[SarvamStream] = None
        self.sarvam_tts = SarvamTTSService()

        self.selected_digit = "3"  # English
        self.is_agent_speaking = False
        self._speak_interrupted = False
        self.started_at = datetime.utcnow()

        self._llm_task: Optional[asyncio.Task] = None
        self._frame_queue: Optional[asyncio.Queue] = None
        self.is_call_active = True
        self.current_turn_id = 0

        # For conversation history
        self.conversation_history = []
        self.transcript_text = ""
        self.system_prompt = ""
        self.outreach_call = None
        self.db: Optional[AsyncSession] = None

    async def send_audio_to_caller(self, mulaw_bytes: bytes) -> None:
        """Send audio frame to Twilio."""
        if not self.stream_sid or not self.is_call_active:
            return
        try:
            await self.ws.send_json({
                "event": "media",
                "streamSid": self.stream_sid,
                "media": {
                    "payload": encode_mulaw_for_twilio(mulaw_bytes)
                },
            })
        except Exception:
            pass

    async def cancel_active_turn(self) -> None:
        """Cancel active LLM task for barge-in."""
        if self._llm_task and not self._llm_task.done():
            self._llm_task.cancel()
            try:
                await asyncio.wait_for(self._llm_task, timeout=0.3)
            except (asyncio.CancelledError, asyncio.TimeoutError):
                pass

    async def speak(self, text: str) -> None:
        """Synthesize and send greeting/response to caller."""
        self.is_agent_speaking = True
        self._speak_interrupted = False

        audio_buffer = bytearray()
        try:
            async for chunk in self.sarvam_tts.stream_tts(text, self.selected_digit, self.call_sid):
                if self._speak_interrupted or not self.is_call_active:
                    break

                audio_buffer.extend(chunk)

                while len(audio_buffer) >= 160:
                    if self._speak_interrupted or not self.is_call_active:
                        break

                    frame = audio_buffer[:160]
                    del audio_buffer[:160]

                    await self.send_audio_to_caller(bytes(frame))
                    await asyncio.sleep(0.02)

        except Exception as exc:
            logger.error(f"[{self.call_sid}] TTS error: {exc}")

        finally:
            self.is_agent_speaking = False
            self._speak_interrupted = False

    async def add_turn(self, role: str, content: str) -> None:
        """Add turn to conversation history."""
        self.conversation_history.append({"role": role, "content": content})
        self.transcript_text += f"{role.upper()}: {content}\n"

        # Persist to DB
        if self.db and self.outreach_call:
            turn = ConversationTurn(
                outreach_call_id=self.outreach_call.id,
                role=role,
                content=content,
                timestamp=datetime.utcnow(),
            )
            self.db.add(turn)
            await self.db.flush()

    async def handle_transcript(self, text: str, is_final: bool) -> None:
        """Handle final transcript from STT. Spawn producer-consumer for response."""
        if not self.is_call_active or not is_final or not text:
            return

        self.current_turn_id += 1
        active_turn = self.current_turn_id

        logger.info(f"[{self.call_sid}] Patient said: {text}")
        self._speak_interrupted = True

        await self.cancel_active_turn()
        await asyncio.sleep(0.1)

        self.is_agent_speaking = True
        self._speak_interrupted = False

        # Add patient turn
        await self.add_turn("user", text)

        # Producer: Stream Claude response + TTS
        async def fetch_claude_and_tts():
            logger.info(f"[{self.call_sid}] Producer started")
            full_response = ""
            try:
                async for sentence in stream_conversation(
                    system_prompt=self.system_prompt,
                    conversation_history=self.conversation_history,
                    max_tokens=300,
                ):
                    if self.current_turn_id != active_turn:
                        logger.info(f"[{self.call_sid}] Discarding stale turn {active_turn}")
                        break
                    if not self.is_call_active or self._speak_interrupted:
                        break

                    # Accumulate full response
                    full_response += sentence + " "

                    # Parse control tokens
                    end_call = "[[END_CALL]]" in sentence
                    clean_sentence = sentence.replace("[[END_CALL]]", "").strip()

                    if clean_sentence:
                        logger.info(f"[{self.call_sid}] Agent: {clean_sentence}")

                        try:
                            local_buffer = bytearray()
                            async for chunk in self.sarvam_tts.stream_tts(
                                clean_sentence, self.selected_digit, self.call_sid
                            ):
                                if self.current_turn_id != active_turn:
                                    break
                                if self._speak_interrupted or not self.is_call_active:
                                    break

                                local_buffer.extend(chunk)
                                while len(local_buffer) >= 160:
                                    if self.current_turn_id != active_turn:
                                        break
                                    if self._speak_interrupted or not self.is_call_active:
                                        break
                                    frame = bytes(local_buffer[:160])
                                    del local_buffer[:160]
                                    await self._frame_queue.put(frame)

                            if len(local_buffer) > 0:
                                local_buffer.clear()

                        except Exception as tts_err:
                            logger.error(f"[{self.call_sid}] TTS error: {tts_err}")
                            self.sarvam_tts.ws = None

                    if end_call:
                        await self._frame_queue.put("END_CALL")

                # Add complete response to conversation history
                if full_response.strip():
                    await self.add_turn("assistant", full_response.strip())

            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.error(f"[{self.call_sid}] Producer error: {exc}", exc_info=True)
            finally:
                if not asyncio.current_task().cancelled():
                    await self._frame_queue.put(None)
                logger.info(f"[{self.call_sid}] Producer finished")

        self._frame_queue = asyncio.Queue()
        self._llm_task = asyncio.create_task(fetch_claude_and_tts())

        # Consumer: Stream frames to Twilio
        logger.info(f"[{self.call_sid}] Consumer started")
        try:
            while True:
                if self.current_turn_id != active_turn:
                    break
                if not self.is_call_active or self._speak_interrupted:
                    break

                frame_item = await self._frame_queue.get()
                try:
                    if frame_item is None:
                        logger.info(f"[{self.call_sid}] Queue EOF")
                        break
                    if frame_item == "END_CALL":
                        logger.info(f"[{self.call_sid}] END_CALL received")
                        self.is_call_active = False
                        break

                    await self.send_audio_to_caller(frame_item)
                    await asyncio.sleep(0.02)

                finally:
                    self._frame_queue.task_done()

        except Exception as exc:
            logger.error(f"[{self.call_sid}] Consumer error: {exc}")
        finally:
            logger.info(f"[{self.call_sid}] Consumer finished")

    async def close(self) -> None:
        """Clean up session."""
        self.is_call_active = False
        if self._llm_task and not self._llm_task.done():
            self._llm_task.cancel()
        if self.sarvam_stt:
            await self.sarvam_stt.stop()
        if self.sarvam_tts:
            await self.sarvam_tts.close(call_sid=self.call_sid)
        if self.db:
            await self.db.commit()
