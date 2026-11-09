"""
Sarvam WebSocket text-to-speech, streamed as Twilio-ready 8 kHz mu-law.

Each sentence uses its own Sarvam connection (config -> text -> flush -> audio... -> final), as
before. To take the connection set-up off the critical path, the next connection is opened and
configured in advance ("warm spare") while the current sentence plays. A spare that has gone
stale is replaced, and a sentence retries once on a fresh connection if the spare fails.
"""

import asyncio
import audioop
import base64
import json
import logging
import time
from typing import AsyncGenerator, Optional

import websockets
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

SARVAM_TTS_URL = "wss://api.sarvam.ai/text-to-speech/ws?model=bulbul:v3&send_completion_event=true"
# A prepared connection older than this is not trusted (the server may have closed it)
SPARE_MAX_AGE_SECONDS = 20.0
FIRST_CHUNK_TIMEOUT = 5.0
NEXT_CHUNK_TIMEOUT = 1.5


class SarvamTTSService:
    def __init__(self):
        self.ws: Optional[websockets.WebSocketClientProtocol] = None
        # IVR language map
        self.language_map = {
            "1": "te-IN",   # Telugu
            "2": "hi-IN",   # Hindi
            "3": "en-IN",   # English
            "4": "kn-IN",   # Kannada
            "5": "ml-IN",   # Malayalam
            "6": "ta-IN",   # Tamil
        }
        self._spare: Optional[tuple] = None  # (websocket, language_code, opened_at)
        self._spare_task: Optional[asyncio.Task] = None
        self._closed = False

    def get_language_code(self, digit: str) -> str:
        return self.language_map.get(digit, "en-IN")

    # ---------- Connections ----------

    async def _open(self, language_code: str):
        """Open a Sarvam connection and send its config frame."""
        ws = await websockets.connect(SARVAM_TTS_URL, extra_headers={"api-subscription-key": settings.sarvam_api_key})
        config_message = {
            "type": "config",
            "data": {
                "speaker": "ritu",
                "language_code": language_code,
                "pace": 0.9,
                "temperature": 0.6,
                "min_buffer_size": 50,
                "max_chunk_length": 200,
                "output_audio_codec": "mulaw",
            },
        }
        await ws.send(json.dumps(config_message))
        logger.debug("Sarvam TTS connection opened (%s)", language_code)
        return ws

    async def _make_spare(self, language_code: str) -> None:
        try:
            ws = await self._open(language_code)
        except Exception as exc:
            logger.debug("Sarvam spare connection failed: %s", exc)
            return
        if self._closed:
            await _close_quietly(ws)
            return
        self._spare = (ws, language_code, time.monotonic())

    def prewarm(self, selected_digit: str) -> None:
        """Open the next sentence's connection in the background."""
        if self._closed or self._spare or (self._spare_task and not self._spare_task.done()):
            return
        self._spare_task = asyncio.create_task(self._make_spare(self.get_language_code(selected_digit)))

    async def _take_connection(self, language_code: str):
        """The prepared connection if it is usable, else a new one. Returns (websocket, was_spare)."""
        if self._spare_task and not self._spare_task.done():
            try:
                await self._spare_task  # still faster than starting a new connection from scratch
            except Exception:
                pass
        self._spare_task = None
        spare, self._spare = self._spare, None
        if spare:
            ws, lang, opened_at = spare
            if lang == language_code and not ws.closed and time.monotonic() - opened_at < SPARE_MAX_AGE_SECONDS:
                return ws, True
            await _close_quietly(ws)
        return await self._open(language_code), False

    # ---------- Streaming ----------

    async def stream_tts(self, text: str, selected_digit: str, call_sid: str = "") -> AsyncGenerator[bytes, None]:
        """Stream 8 kHz mu-law audio chunks for one sentence as they arrive from Sarvam."""
        language_code = self.get_language_code(selected_digit)
        ws, was_spare = await self._take_connection(language_code)
        self.ws = ws
        try:
            try:
                await ws.send(json.dumps({"type": "text", "data": {"text": text}}))
                await ws.send(json.dumps({"type": "flush"}))
            except Exception:
                if not was_spare:
                    raise
                # The prepared connection had gone stale: retry once on a fresh one
                await _close_quietly(ws)
                ws = await self._open(language_code)
                self.ws = ws
                await ws.send(json.dumps({"type": "text", "data": {"text": text}}))
                await ws.send(json.dumps({"type": "flush"}))
            logger.debug("Sarvam text sent [call_sid=%s] (%d chars)", call_sid, len(text))

            first = True
            resample_state = None  # carried across chunks so chunk boundaries don't click
            while True:
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=FIRST_CHUNK_TIMEOUT if first else NEXT_CHUNK_TIMEOUT)
                except asyncio.TimeoutError:
                    logger.warning("Sarvam audio timed out; treating the sentence as complete [call_sid=%s]", call_sid)
                    break
                data = json.loads(msg)
                kind = data.get("type")
                if kind == "audio":
                    first = False
                    raw_mulaw = base64.b64decode(data["data"]["audio"])
                    pcm_24k = audioop.ulaw2lin(raw_mulaw, 2)  # mu-law -> 16-bit PCM
                    pcm_8k, resample_state = audioop.ratecv(pcm_24k, 2, 1, 24000, 8000, resample_state)
                    yield audioop.lin2ulaw(pcm_8k, 2)
                elif kind == "event":
                    if data.get("data", {}).get("event_type") == "final":
                        break
                elif kind == "error":
                    logger.error("Sarvam TTS error [call_sid=%s]: %s", call_sid, data.get("data"))
                    break
        finally:
            await _close_quietly(ws)
            self.ws = None
            self.prewarm(selected_digit)  # get the next sentence's connection ready

    async def close(self, call_sid: str = ""):
        """Close every connection (end of call)."""
        self._closed = True
        if self._spare_task and not self._spare_task.done():
            self._spare_task.cancel()
        spare, self._spare = self._spare, None
        if spare:
            await _close_quietly(spare[0])
        if self.ws:
            await _close_quietly(self.ws)
            self.ws = None
        logger.debug("Sarvam TTS closed [call_sid=%s]", call_sid)

    async def text_to_speech(self, text: str, selected_digit: str) -> bytes:
        """Non-streaming helper: the whole sentence as one mu-law buffer."""
        audio_chunks = []
        stream = self.stream_tts(text, selected_digit)
        try:
            async for chunk in stream:
                audio_chunks.append(chunk)
        finally:
            await stream.aclose()
        if not audio_chunks:
            raise RuntimeError("Sarvam TTS returned no audio")
        return b"".join(audio_chunks)


async def _close_quietly(ws) -> None:
    try:
        if ws and not ws.closed:
            await ws.close()
    except Exception:
        pass


async def text_to_mulaw(text: str, selected_digit: str) -> bytes:
    """Compatibility layer for services expecting text_to_mulaw."""
    srv = SarvamTTSService()
    try:
        return await srv.text_to_speech(text, selected_digit)
    finally:
        await srv.close()
