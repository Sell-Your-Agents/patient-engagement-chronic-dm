"""Plivo realtime text-to-speech, streamed as 8 kHz mu-law (for testing; pick it with TTS_PROVIDER=plivo)."""

import asyncio

import base64

import json

import logging

import time

from typing import AsyncGenerator, Optional
 
import websockets

from app.config import get_settings
 
logger = logging.getLogger(__name__)

settings = get_settings()
 
PLIVO_TTS_URL = settings.plivo_tts_ws_url
 
MAX_REPLIES_PER_SOCKET = 8

FIRST_CHUNK_TIMEOUT = 5.0

NEXT_CHUNK_TIMEOUT = 1.5
 
 
class PlivoTTSService:

    def __init__(self):

        self.ws: Optional[websockets.WebSocketClientProtocol] = None

        self._closed = False

        self._contexts_used = 0

        self._context_seq = 0

        self._connections_opened = 0
 
        # Plivo voices. Replace these with your preferred voice_id from List Voices API if needed.

        self.language_voice_map = {

            # Your IVR digits

            "1": {

                "language": "te",

                "voice_id": "v2jq1LG20JPbAVrlTWmZ",  # Abhiram, Telugu

            },

            "2": {

                "language": "hi",

                "voice_id": "6uWzc4xFj31t4jNJUaED",  # Meera, Hindi

            },

            "3": {

                "language": "en-IN",

                "voice_id": "H25SvwivznBqsIx1R7hX",  # Nisha, English India

            },

            "4": {

                "language": "kn",

                "voice_id": "iNhbJlZPe4LFctxRtJPD",  # Bhavana, Kannada

            },

            "5": {

                # Malayalam is not currently listed in Plivo TTS voices.

                # Fallback to English India or change to another supported language.

                "language": "en-IN",

                "voice_id": "H25SvwivznBqsIx1R7hX",

            },

            "6": {

                "language": "ta",

                "voice_id": "wDPugzmr5HSlFv9MaXk0",  # Nandhini, Tamil

            },

        }
 
        # Optional full Plivo language map

        self.all_plivo_languages = {

            "en-US": "GhXTeeZNT1zacg9RUbXa",  # Allison

            "en-GB": "Ic0DJ4TLN1ELIYmzwi6H",  # Eleanor

            "en-IN": "H25SvwivznBqsIx1R7hX",  # Nisha

            "en-AU": "S4OkXYkfzKK9f6wzmQ0X",  # Tahlia

            "hi": "6uWzc4xFj31t4jNJUaED",     # Meera

            "bn": "cZncSKHriH32h4IKwAF1",     # Debasmita

            "ta": "wDPugzmr5HSlFv9MaXk0",     # Nandhini

            "te": "v2jq1LG20JPbAVrlTWmZ",     # Abhiram

            "mr": "KCWPtNGDMOQ5bI9SiaIm",     # Sanika

            "gu": "xHCIssLpg7mFHuxJAl5D",     # Hiren

            "kn": "iNhbJlZPe4LFctxRtJPD",     # Bhavana

        }
 
    def get_voice_config(self, selected_digit: str) -> dict:

        return self.language_voice_map.get(

            selected_digit,

            {

                "language": settings.plivo_tts_default_language,

                "voice_id": settings.plivo_tts_default_voice_id,

            },

        )
 
    def prewarm(self, selected_digit: str = "") -> None:
        """Open the Plivo socket in the background so the first sentence starts faster."""
        if self._closed or (self.ws and not self.ws.closed):
            return

        async def _warm():
            try:
                await self._get_connection()
                logger.info("Plivo TTS prewarmed [digit=%s]", selected_digit or "-")
            except Exception as exc:
                logger.warning("Plivo TTS prewarm failed [digit=%s]: %s", selected_digit or "-", exc)

        try:
            asyncio.get_running_loop().create_task(_warm())
        except RuntimeError:
            logger.debug("Plivo TTS prewarm skipped: no running event loop")

    def _next_context_id(self) -> str:
        self._context_seq += 1
        return f"ctx-{int(time.time() * 1000)}-{self._context_seq}"

    async def _open(self):
        url = PLIVO_TTS_URL
        if not settings.plivo_auth_id or not settings.plivo_auth_token:
            logger.error("Plivo TTS: PLIVO_AUTH_ID / PLIVO_AUTH_TOKEN are not set in .env")

        token = base64.b64encode(
            f"{settings.plivo_auth_id}:{settings.plivo_auth_token}".encode("utf-8")
        ).decode("utf-8")
        headers = {"Authorization": f"Basic {token}"}

        started = time.monotonic()
        try:
            try:
                ws = await websockets.connect(url, additional_headers=headers)
            except TypeError:
                # For older versions of the websockets package
                ws = await websockets.connect(url, extra_headers=headers)
        except Exception as exc:
            logger.error(
                "Plivo TTS connection failed after %d ms: %s",
                (time.monotonic() - started) * 1000,
                exc,
            )
            raise

        self._contexts_used = 0
        self._connections_opened += 1
        logger.info(
            "Plivo TTS WebSocket opened in %d ms [connection #%d]",
            (time.monotonic() - started) * 1000,
            self._connections_opened,
        )
        return ws

    async def _get_connection(self):
        if self._closed:
            logger.warning("Plivo TTS used after close()")
            raise RuntimeError("PlivoTTSService is closed")

        if self.ws and not self.ws.closed and self._contexts_used < MAX_REPLIES_PER_SOCKET:
            logger.debug("Plivo TTS reusing socket [sentences_on_socket=%d]", self._contexts_used)
            return self.ws

        if self.ws:
            if self.ws.closed:
                logger.info("Plivo TTS socket was closed by the server; reconnecting")
            else:
                logger.info(
                    "Plivo TTS socket reached %d sentences; opening a fresh one", MAX_REPLIES_PER_SOCKET
                )
            await self._close_quietly(self.ws)

        self.ws = await self._open()
        return self.ws

    def _parse_audio_frame(self, frame: bytes) -> tuple:
        """
        Plivo realtime audio frame format:
        [2 bytes context_id length, little-endian][context_id][audio bytes]
        """
        if len(frame) < 2:
            logger.debug("Plivo TTS frame too short (%d bytes)", len(frame))
            return "", b""

        context_len = int.from_bytes(frame[:2], "little")
        audio_start = 2 + context_len
        if len(frame) <= audio_start:
            logger.debug("Plivo TTS frame has no audio (%d bytes)", len(frame))
            return "", b""

        context_id = frame[2:audio_start].decode("utf-8", errors="replace")
        return context_id, frame[audio_start:]

    async def stream_tts(
        self,
        text: str,
        selected_digit: str,
        call_sid: str = "",
    ) -> AsyncGenerator[bytes, None]:
        """
        Stream 8 kHz mu-law audio chunks for one sentence using Plivo TTS.
        The yielded bytes are raw pcm_mulaw at 8000 Hz.
        """
        if not text or not text.strip():
            logger.debug("Plivo TTS skipped empty text [call_sid=%s]", call_sid)
            return

        voice_config = self.get_voice_config(selected_digit)
        language = voice_config["language"]
        voice_id = voice_config["voice_id"]
        if selected_digit not in self.language_voice_map:
            logger.warning(
                "Plivo TTS: no voice for digit %r, using default %s [call_sid=%s]",
                selected_digit,
                language,
                call_sid,
            )

        started = time.monotonic()
        ws = await self._get_connection()
        context_id = self._next_context_id()
        self._contexts_used += 1

        message = {
            "type": "text",
            "context_id": context_id,
            "voice_id": voice_id,
            "language": language,
            "text": text,
            "finish": True,
            "output_format": {
                "container": "raw",
                "encoding": settings.plivo_tts_encoding,
                "sample_rate": settings.plivo_tts_sample_rate,
            },
            # Speaking speed (1.0 = normal). English at 0.9 sounded too slow; Telugu and Hindi keep 0.9.
            "pace": settings.plivo_tts_pace_en if language.startswith("en") else settings.plivo_tts_pace,
        }

        await ws.send(json.dumps(message))
        # Only the length is logged, not the text: sentences can contain patient details
        logger.info(
            "Plivo TTS sentence started [call_sid=%s, context_id=%s, language=%s, voice=%s, chars=%d]",
            call_sid,
            context_id,
            language,
            voice_id,
            len(text),
        )

        first = True
        finished = False
        outcome = "interrupted"
        chunks = 0
        audio_bytes = 0
        stale_frames = 0

        try:
            while True:
                try:
                    msg = await asyncio.wait_for(
                        ws.recv(),
                        timeout=FIRST_CHUNK_TIMEOUT if first else NEXT_CHUNK_TIMEOUT,
                    )
                except asyncio.TimeoutError:
                    outcome = "timeout"
                    logger.warning(
                        "Plivo TTS audio timed out after %.1f s (%s); treating sentence as complete "
                        "[call_sid=%s, context_id=%s]",
                        FIRST_CHUNK_TIMEOUT if first else NEXT_CHUNK_TIMEOUT,
                        "no audio at all" if first else "mid-sentence",
                        call_sid,
                        context_id,
                    )
                    break
                except websockets.ConnectionClosed as exc:
                    outcome = "connection closed"
                    logger.error(
                        "Plivo TTS connection closed mid-sentence [call_sid=%s, context_id=%s]: %s",
                        call_sid,
                        context_id,
                        exc,
                    )
                    break

                if isinstance(msg, bytes):
                    frame_context, audio = self._parse_audio_frame(msg)
                    # Skip leftover audio from an earlier sentence on this socket
                    if audio and frame_context == context_id:
                        if first:
                            logger.info(
                                "Plivo TTS first audio in %d ms [call_sid=%s, context_id=%s]",
                                (time.monotonic() - started) * 1000,
                                call_sid,
                                context_id,
                            )
                        first = False
                        chunks += 1
                        audio_bytes += len(audio)
                        yield audio
                    elif audio:
                        stale_frames += 1
                    continue

                try:
                    event = json.loads(msg)
                except json.JSONDecodeError:
                    logger.warning("Plivo TTS returned non-JSON text frame: %s", msg)
                    continue

                event_type = event.get("type")

                if event_type == "done" and event.get("context_id") == context_id:
                    finished = True
                    outcome = "done (%s)" % event.get("reason")
                    break

                if event_type == "error":
                    outcome = "error"
                    logger.error(
                        "Plivo TTS error [call_sid=%s, context_id=%s]: %s", call_sid, context_id, event
                    )
                    break

                if event_type == "warning":
                    logger.warning(
                        "Plivo TTS warning [call_sid=%s, context_id=%s]: %s", call_sid, context_id, event
                    )
                else:
                    logger.debug(
                        "Plivo TTS event %s [call_sid=%s, context_id=%s]", event_type, call_sid, context_id
                    )
        finally:
            sample_rate = settings.plivo_tts_sample_rate or 8000
            logger.info(
                "Plivo TTS sentence %s [call_sid=%s, context_id=%s, chunks=%d, audio=%.2f s, total=%d ms]",
                outcome,
                call_sid,
                context_id,
                chunks,
                audio_bytes / sample_rate,
                (time.monotonic() - started) * 1000,
            )
            if stale_frames:
                logger.debug(
                    "Plivo TTS skipped %d leftover frames from an earlier sentence [call_sid=%s]",
                    stale_frames,
                    call_sid,
                )
            # Caller barged in, timeout or error: this socket may still carry this sentence's
            # audio, so drop it and let the next sentence open a fresh one.
            if not finished and self.ws is ws:
                logger.debug("Plivo TTS dropping socket after unfinished sentence [call_sid=%s]", call_sid)
                self.ws = None
                await self._close_quietly(ws)

    async def text_to_speech(self, text: str, selected_digit: str) -> bytes:
        """
        Non-streaming helper: returns the whole sentence as one raw 8 kHz mu-law buffer.
        """
        audio_chunks = []
        stream = self.stream_tts(text, selected_digit)
        try:
            async for chunk in stream:
                audio_chunks.append(chunk)
        finally:
            await stream.aclose()

        if not audio_chunks:
            logger.error("Plivo TTS returned no audio [digit=%s, chars=%d]", selected_digit, len(text or ""))
            raise RuntimeError("Plivo TTS returned no audio")

        return b"".join(audio_chunks)

    async def close(self, call_sid: str = ""):
        self._closed = True
        if self.ws:
            await self._close_quietly(self.ws)
            self.ws = None
        logger.info(
            "Plivo TTS closed [call_sid=%s, sentences=%d, connections=%d]",
            call_sid,
            self._context_seq,
            self._connections_opened,
        )

    async def _close_quietly(self, ws) -> None:
        try:
            if ws and not ws.closed:
                await ws.close()
        except Exception as exc:
            logger.debug("Plivo TTS socket close error (ignored): %s", exc)
 
 
async def text_to_mulaw(text: str, selected_digit: str) -> bytes:

    """

    Compatibility layer for services expecting text_to_mulaw.

    """

    srv = PlivoTTSService()

    try:

        return await srv.text_to_speech(text, selected_digit)

    finally:

        await srv.close()
