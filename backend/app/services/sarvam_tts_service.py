"""
Sarvam WebSocket Text-to-Speech service.
Supports IVR language selection.
Returns Twilio-ready μ-law audio.
"""

import asyncio
import json
import logging
import base64
import audioop
from typing import Optional, AsyncGenerator
import websockets
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

SARVAM_TTS_URL = "wss://api.sarvam.ai/text-to-speech/ws?model=bulbul:v3&send_completion_event=true"


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

    def get_language_code(self, digit: str) -> str:
        """
        Dynamic language from IVR selection.
        """
        return self.language_map.get(digit, "en-IN")

    async def connect(self):
        """
        Open a fresh Sarvam WebSocket connection.
        """
        self.ws = await websockets.connect(
            SARVAM_TTS_URL,
            extra_headers={
                "api-subscription-key": settings.sarvam_api_key
            }
        )
        logger.info("Sarvam TTS WebSocket connected")

    async def ensure_session_ws(self, language_code: str):
        """
        Open a fresh WebSocket and send the config frame.
        Called once per streaming session before text is sent.
        """
        # Close any existing connection first
        if self.ws and not self.ws.closed:
            try:
                await self.ws.close()
            except Exception:
                pass

        await self.connect()

        # CONFIG — all fixes applied:
        # - language_code (not target_language_code)
        # - speech_sample_rate / sample_rate removed — not WebSocket params
        # - speaker fixed to "ritu"
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
                # No sample_rate — not a valid WebSocket config parameter
            }
        }

        logger.info("Sending config: %s", config_message)
        await self.ws.send(json.dumps(config_message))

    async def stream_tts(
        self,
        text: str,
        selected_digit: str,
        call_sid: str = ""
    ) -> AsyncGenerator[bytes, None]:
        """
        Streams μ-law audio chunks as they arrive from Sarvam.
        Downsamples 24kHz → 8kHz via audioop for Twilio compatibility.
        Yields each chunk immediately — first audio in under 200ms.

        Usage in twilio_service.py:
            async for chunk in self.sarvam_tts.stream_tts(
                clean_sentence, self.selected_digit, self.call_sid
            ):
                # send chunk to Twilio
        """
        language_code = self.get_language_code(selected_digit)

        await self.ensure_session_ws(language_code)

        try:
            # STEP 2: TEXT
            text_message = {
                "type": "text",
                "data": {
                    "text": text
                }
            }
            logger.info("Sending text [call_sid=%s]: %s", call_sid, text_message)
            await self.ws.send(json.dumps(text_message))

            # STEP 3: FLUSH
            logger.info("Sending flush [call_sid=%s]", call_sid)
            await self.ws.send(json.dumps({"type": "flush"}))

            is_first_chunk = True

            # Carry resampling state across chunks to avoid
            # clicks or discontinuities at chunk boundaries
            resample_state = None

            while True:
                try:
                    # Longer timeout for first chunk (model warm-up),
                    # shorter for subsequent chunks
                    current_timeout = 2.0 if is_first_chunk else 0.3
                    msg = await asyncio.wait_for(
                        self.ws.recv(),
                        timeout=current_timeout
                    )

                    data = json.loads(msg)
                    logger.info(
                        "Sarvam message type: %s [call_sid=%s]",
                        data.get("type"),
                        call_sid
                    )

                    # Audio chunk — correct μ-law 24kHz → 8kHz for Twilio
                    if data.get("type") == "audio":
                        is_first_chunk = False
                        raw_mulaw = base64.b64decode(data["data"]["audio"])

                        # Step 1: Decode μ-law → linear PCM (16-bit)
                        pcm_24k = audioop.ulaw2lin(raw_mulaw, 2)

                        # Step 2: Resample 24kHz → 8kHz with anti-aliasing.
                        # resample_state is carried across chunks to prevent
                        # boundary artifacts between consecutive chunks.
                        pcm_8k, resample_state = audioop.ratecv(
                            pcm_24k,
                            2,              # 16-bit samples (2 bytes)
                            1,              # mono
                            24000,          # Sarvam native output rate
                            8000,           # Twilio required rate
                            resample_state  # filter state across chunks
                        )

                        # Step 3: Re-encode linear PCM → μ-law
                        mulaw_8k = audioop.lin2ulaw(pcm_8k, 2)

                        yield mulaw_8k

                    # Completion event — exit loop cleanly
                    elif data.get("type") == "event":
                        event_type = data.get("data", {}).get("event_type")
                        logger.info(
                            "Received event: %s [call_sid=%s]",
                            event_type,
                            call_sid
                        )
                        if event_type == "final":
                            logger.info(
                                "Final event received — stream complete [call_sid=%s]",
                                call_sid
                            )
                            break

                except asyncio.TimeoutError:
                    logger.warning(
                        "Timeout waiting for Sarvam audio chunk — "
                        "assuming stream complete [call_sid=%s]",
                        call_sid
                    )
                    break

        finally:
            # Always close the WebSocket after each streaming request
            if self.ws and not self.ws.closed:
                try:
                    await self.ws.close()
                    logger.info(
                        "Sarvam TTS WebSocket closed [call_sid=%s]",
                        call_sid
                    )
                except Exception as e:
                    logger.warning(
                        "Error closing WebSocket [call_sid=%s]: %s",
                        call_sid,
                        e
                    )

    async def close(self, call_sid: str = ""):
        """
        Close WebSocket session.
        Called by twilio_service.py on cleanup and language switching.
        """
        if self.ws and not self.ws.closed:
            try:
                await self.ws.close()
                logger.info(
                    "Sarvam TTS WebSocket closed via close() [call_sid=%s]",
                    call_sid
                )
            except Exception as e:
                logger.warning(
                    "Error in close() [call_sid=%s]: %s",
                    call_sid,
                    e
                )
            finally:
                self.ws = None

    async def text_to_speech(self, text: str, selected_digit: str) -> bytes:
        """
        Non-streaming fallback. Accumulates all chunks and returns
        a single bytes object. Use stream_tts for live calls.
        """
        audio_chunks = []

        async for chunk in self.stream_tts(text, selected_digit):
            audio_chunks.append(chunk)

        if not audio_chunks:
            logger.error("No audio received from Sarvam TTS")
            raise RuntimeError("Sarvam TTS returned no audio")

        final_audio = b"".join(audio_chunks)
        logger.info(
            "TTS complete: %d chunks, %d bytes total",
            len(audio_chunks),
            len(final_audio)
        )
        return final_audio


async def text_to_mulaw(text: str, selected_digit: str) -> bytes:
    """
    Compatibility layer for services expecting text_to_mulaw.
    """
    srv = SarvamTTSService()
    return await srv.text_to_speech(text, selected_digit)
