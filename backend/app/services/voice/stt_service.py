"""
Deepgram STT service with Flux v2 and Nova-3 v1 routing.

Caller audio is sent to Deepgram directly as it arrives (no queue). Interim text is passed on
(is_final=False) so the session can stop the agent when the caller talks over it (barge-in);
Flux's EagerEndOfTurn is dispatched as final so the reply starts early, and the confirming
EndOfTurn is skipped when it says the same thing.

IVR digit routing:
  1 -> Nova-3 v1 (Telugu)
  2 -> Flux v2   (Hindi, flux-general-multi)
  3 -> Flux v2   (English, flux-general-en)
  4 -> Nova-3 v1 (Kannada)
  5 -> Nova-3 v1 (Malayalam)
  6 -> Nova-3 v1 (Tamil)
"""

import asyncio
import json
import logging
import time
from typing import Callable, Coroutine, Dict, List, Optional

import websockets
import websockets.exceptions  # explicit: not loaded by "import websockets" alone in v13
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# Send a KeepAlive after this long without audio, so Deepgram doesn't close the idle connection
KEEPALIVE_AFTER_SECONDS = 5.0


class DeepgramStream:
    # Configuration mapping per IVR digit
    language_config_map: Dict[str, dict] = {
        "1": {"api_version": "v1", "model": "nova-3", "language": "te"},              # Telugu
        "2": {"api_version": "v2", "model": "flux-general-multi", "language": "hi"},  # Hindi (Flux)
        "3": {"api_version": "v2", "model": "flux-general-en", "language": "en"},     # English (Flux)
        "4": {"api_version": "v1", "model": "nova-3", "language": "kn"},              # Kannada
        "5": {"api_version": "v1", "model": "nova-3", "language": "ml"},              # Malayalam
        "6": {"api_version": "v1", "model": "nova-3", "language": "ta"},              # Tamil
    }

    def __init__(self, on_transcript: Callable[..., Coroutine] = None, selected_digit: str = "3"):
        self.on_transcript = on_transcript
        self.selected_digit = str(selected_digit)
        self._ws: Optional[websockets.WebSocketClientProtocol] = None
        self._running = False
        self._last_send_ts = 0.0
        self._eager_transcript: Optional[str] = None  # last EagerEndOfTurn text already dispatched
        self._last_update_text = ""  # last Flux Update text sent as an interim (barge-in signal)
        self._tasks: List[asyncio.Task] = []
        self._turn_buffer: List[str] = []  # Nova-3 is_final segments of the current turn

    def _dispatch(self, transcript: str, is_final: bool) -> None:
        if self.on_transcript:
            asyncio.create_task(self.on_transcript(transcript, is_final=is_final))

    def _flush_turn_buffer(self, reason: str) -> None:
        """Dispatch the buffered Nova-3 segments as one final caller turn."""
        if not self._turn_buffer:
            return
        full_text = " ".join(self._turn_buffer)
        self._turn_buffer.clear()
        logger.info("Nova-3 %s | '%s'", reason, full_text)
        self._dispatch(full_text, True)

    def get_config(self) -> dict:
        return self.language_config_map.get(
            self.selected_digit,
            {"api_version": "v2", "model": "flux-general-en", "language": "en"},
        )

    async def _connect(self) -> None:
        """Constructs the endpoint URL and opens the Deepgram WebSocket."""
        cfg = self.get_config()
        model = cfg["model"]
        language = cfg["language"]
        api_ver = cfg["api_version"]

        if api_ver == "v2":
            # Deepgram Flux v2. eager_eot_threshold must be <= eot_threshold.
            base_url = (
                f"wss://api.deepgram.com/v2/listen"
                f"?model={model}"
                f"&encoding=mulaw"
                f"&sample_rate=8000"
                f"&eot_threshold=0.7"
                f"&eager_eot_threshold=0.3"
                f"&eot_timeout_ms=1000"
            )
            if model == "flux-general-multi":
                # language_hint for the multilingual model; English as fallback for code-switching
                deepgram_ws_url = f"{base_url}&language_hint={language}&language_hint=en"
            else:
                deepgram_ws_url = base_url
        else:
            # Nova-3 v1 for regional languages
            deepgram_ws_url = (
                f"wss://api.deepgram.com/v1/listen"
                f"?model={model}"
                f"&language={language}"
                f"&encoding=mulaw"
                f"&sample_rate=8000"
                f"&endpointing=500"
                f"&utterance_end_ms=1200"
                f"&interim_results=true"
                f"&smart_format=true"
            )

        headers = {"Authorization": f"Token {settings.deepgram_api_key}"}
        self._ws = await websockets.connect(
            deepgram_ws_url,
            extra_headers=headers,
            ping_interval=None,  # keepalive is handled by _keepalive_loop
        )
        logger.info("STT connected | Model=%s | Language=%s | API=%s", model, language, api_ver)

    async def start(self) -> None:
        """Connects (up to 3 attempts), then starts the keepalive and receive loops."""
        max_retries = 3
        for attempt in range(1, max_retries + 1):
            try:
                await self._connect()
                break
            except Exception as exc:
                logger.error("STT connection failed (attempt %d/%d): %s", attempt, max_retries, exc)
                if attempt == max_retries:
                    raise
                await asyncio.sleep(0.5 * attempt)

        self._running = True
        self._last_send_ts = time.monotonic()
        self._tasks = [
            asyncio.create_task(self._keepalive_loop(), name="stt-keepalive"),
            asyncio.create_task(self._receive_loop(), name="stt-recv"),
        ]

    async def send_audio(self, mulaw_bytes: bytes) -> None:
        """Send caller audio straight to Deepgram (no queue). Ignores empty frames and a closed stream."""
        if not (self._running and mulaw_bytes and self._ws):
            return
        try:
            await self._ws.send(mulaw_bytes)
            self._last_send_ts = time.monotonic()
        except Exception as exc:
            if self._running:
                logger.error("STT send error: %s", exc)
            self._running = False

    async def force_end_turn(self) -> None:
        """
        Immediately end the active Flux v2 turn (manual barge-in / push-to-talk).
        Only valid for v2 connections; requires ForceEndTurn to be enabled on the deployment.
        """
        cfg = self.get_config()
        if cfg["api_version"] != "v2":
            logger.warning("force_end_turn() is only supported on Flux v2 connections.")
            return
        if self._ws and self._running:
            try:
                await self._ws.send(json.dumps({"type": "ForceEndTurn"}))
                logger.info("ForceEndTurn sent.")
            except Exception as exc:
                logger.error("Failed to send ForceEndTurn: %s", exc)

    async def stop(self) -> None:
        """Gracefully close the STT connection."""
        self._running = False
        if self._ws:
            try:
                await self._ws.send(json.dumps({"type": "CloseStream"}))
                await self._ws.close()
                logger.info("STT WebSocket closed cleanly.")
            except Exception as exc:
                logger.debug("STT close (already closed): %s", exc)
        for task in self._tasks:
            task.cancel()
        self._tasks = []

    # -------------------------------------------------------------------------
    # Internal loops
    # -------------------------------------------------------------------------

    async def _keepalive_loop(self) -> None:
        """Send a KeepAlive when no audio has been sent for a while (avoids NET-0001 timeouts)."""
        while self._running:
            await asyncio.sleep(1.0)
            if self._running and time.monotonic() - self._last_send_ts >= KEEPALIVE_AFTER_SECONDS:
                try:
                    await self._ws.send(json.dumps({"type": "KeepAlive"}))
                    self._last_send_ts = time.monotonic()
                    logger.debug("STT KeepAlive sent.")
                except Exception as exc:
                    if self._running:
                        logger.error("KeepAlive send failed: %s", exc)
                    break
        self._running = False

    async def _receive_loop(self) -> None:
        """
        Receives and dispatches Deepgram messages.

        Flux v2 (TurnInfo):
          - StartOfTurn    -> turn opened
          - Update         -> interim partial transcript (is_final=False, used for barge-in)
          - EagerEndOfTurn -> early confident end of turn (dispatched as final to start the reply early)
          - EndOfTurn      -> confirmed final transcript (skipped if it matches the eager one)
          - TurnResumed    -> the caller kept speaking after EagerEndOfTurn

        Nova-3 v1 (Results):
          - is_final segments are buffered; speech_final / UtteranceEnd dispatch the joined turn
        """
        while self._running:
            try:
                raw = await asyncio.wait_for(self._ws.recv(), timeout=1.0)
                data = json.loads(raw)

                msg_type = data.get("type")
                event = data.get("event") or data.get("event_type")

                if msg_type == "TurnInfo":
                    transcript = data.get("transcript", "").strip()
                    turn_index = data.get("turn_index")
                    trigger = data.get("trigger")

                    if event == "StartOfTurn":
                        self._last_update_text = ""
                        logger.debug("Flux StartOfTurn | turn=%s", turn_index)

                    elif event == "Update":
                        # Partial text while the caller speaks: an interim for barge-in. Skipped while
                        # an eager reply is pending (Flux can repeat the same text then).
                        if transcript and self._eager_transcript is None and transcript != self._last_update_text:
                            self._last_update_text = transcript
                            logger.debug("Flux Update | turn=%s | '%s'", turn_index, transcript)
                            self._dispatch(transcript, False)

                    elif event == "EagerEndOfTurn":
                        if transcript:
                            logger.info("Flux EagerEndOfTurn | turn=%s | '%s'", turn_index, transcript)
                            self._eager_transcript = transcript
                            self._dispatch(transcript, True)

                    elif event == "EndOfTurn":
                        eager, self._eager_transcript = self._eager_transcript, None
                        self._last_update_text = ""
                        if transcript and transcript == eager:
                            logger.debug("Flux EndOfTurn | turn=%s | matches eager, skipping", turn_index)
                        elif transcript:
                            logger.info("Flux EndOfTurn | turn=%s | trigger=%s | '%s'", turn_index, trigger, transcript)
                            self._dispatch(transcript, True)
                        else:
                            logger.debug("Flux EndOfTurn | turn=%s | trigger=%s | (empty)", turn_index, trigger)

                    elif event == "TurnResumed":
                        # The caller kept talking: forget the eager text so the real EndOfTurn dispatches
                        self._eager_transcript = None
                        logger.debug("Flux TurnResumed | turn=%s", turn_index)

                    else:
                        logger.debug("Flux TurnInfo unknown event=%s | data=%s", event, data)

                elif msg_type == "Connected":
                    logger.debug("Deepgram Flux v2 Connected: %s", data)

                elif msg_type == "Error":
                    code = data.get("code", "")
                    description = data.get("description", "")
                    logger.error("Deepgram server error: %s - %s", code, description)
                    if code == "UNPARSABLE_CLIENT_MESSAGE":
                        logger.error("ForceEndTurn is not enabled on this deployment.")

                elif msg_type == "Results":
                    channel = data.get("channel", {})
                    alternatives = channel.get("alternatives", [{}])
                    transcript = alternatives[0].get("transcript", "").strip() if alternatives else ""
                    speech_final = data.get("speech_final", False)
                    is_final = data.get("is_final", False)

                    # One spoken turn arrives as several is_final segments; only the last is speech_final
                    if is_final and transcript:
                        self._turn_buffer.append(transcript)
                    if speech_final:
                        self._flush_turn_buffer("speech_final")
                    elif transcript and not is_final:
                        self._dispatch(transcript, False)  # interim: the caller is still speaking

                elif msg_type == "UtteranceEnd":
                    # Silence after speech with no speech_final: flush what we have
                    self._flush_turn_buffer("UtteranceEnd")

                else:
                    logger.debug("STT message type=%s | %s", msg_type, data)

            except asyncio.TimeoutError:
                continue  # normal: nothing within 1 s
            except websockets.exceptions.ConnectionClosedOK:
                logger.debug("STT WebSocket closed normally.")
                break
            except websockets.exceptions.ConnectionClosedError as exc:
                if self._running:
                    logger.error("STT WebSocket closed with error: %s", exc)
                break
            except Exception as exc:
                logger.error("STT receive loop error: %s", exc)
                break

        self._running = False


async def create_stt_client(language: str = "en"):
    """Factory function to create and connect an STT client."""
    client = DeepgramStream(selected_digit="3")  # Default to English / Flux v2
    await client.start()
    return client
