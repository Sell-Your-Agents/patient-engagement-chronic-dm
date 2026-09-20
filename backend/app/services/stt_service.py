"""
Deepgram STT service with Flux v2 and Nova-3 v1 routing.

IVR digit routing:
  1 → Nova-3 v1 (Telugu)
  2 → Flux v2   (Hindi, flux-general-multi)
  3 → Flux v2   (English, flux-general-en)
  4 → Nova-3 v1 (Kannada)
  5 → Nova-3 v1 (Malayalam)
  6 → Nova-3 v1 (Tamil)
"""

import asyncio
import json
import logging
from typing import Callable, Coroutine, Dict, List, Optional

import websockets
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class SarvamStream:
    # Configuration mapping per IVR digit
    language_config_map: Dict[str, dict] = {
        "1": {"api_version": "v1", "model": "nova-3", "language": "te"},           # Telugu
        "2": {"api_version": "v2", "model": "flux-general-multi", "language": "hi"},  # Hindi (Flux)
        "3": {"api_version": "v2", "model": "flux-general-en",    "language": "en"},  # English (Flux)
        "4": {"api_version": "v1", "model": "nova-3", "language": "kn"},           # Kannada
        "5": {"api_version": "v1", "model": "nova-3", "language": "ml"},           # Malayalam
        "6": {"api_version": "v1", "model": "nova-3", "language": "ta"},           # Tamil
    }

    def __init__(self, on_transcript: Callable[..., Coroutine] = None, selected_digit: str = "3"):
        self.on_transcript = on_transcript
        self.selected_digit = str(selected_digit)
        self._ws: Optional[websockets.WebSocketClientProtocol] = None
        self._send_queue: asyncio.Queue = asyncio.Queue()
        self._running = False
        self._tasks: List[asyncio.Task] = []

    def get_config(self) -> dict:
        return self.language_config_map.get(
            self.selected_digit,
            {"api_version": "v2", "model": "flux-general-en", "language": "en"},
        )

    async def _connect(self) -> None:
        """Constructs endpoint URL and establishes the Deepgram WebSocket connection."""
        cfg = self.get_config()
        model = cfg["model"]
        language = cfg["language"]
        api_ver = cfg["api_version"]

        if api_ver == "v2":
            # Deepgram Flux v2 endpoint
            # eot_threshold=0.7 is required when eager_eot_threshold=0.5
            # (eager_eot_threshold must be <= eot_threshold)
            base_url = (
                f"wss://api.deepgram.com/v2/listen"
                f"?model={model}"
                f"&encoding=mulaw"
                f"&sample_rate=8000"
                f"&eot_threshold=0.7"
                f"&eager_eot_threshold=0.5"
                f"&eot_timeout_ms=2000"
            )
            if model == "flux-general-multi":
                # language_hint for multilingual model; add English as fallback for code-switching
                deepgram_ws_url = f"{base_url}&language_hint={language}&language_hint=en"
            else:
                deepgram_ws_url = base_url

        else:
            # Nova-3 v1 endpoint for regional languages
            deepgram_ws_url = (
                f"wss://api.deepgram.com/v1/listen"
                f"?model={model}"
                f"&language={language}"
                f"&encoding=mulaw"
                f"&sample_rate=8000"
                f"&endpointing=300"
                f"&interim_results=true"
                f"&smart_format=true"
            )

        headers = {"Authorization": f"Token {settings.deepgram_api_key}"}

        self._ws = await websockets.connect(
            deepgram_ws_url,
            extra_headers=headers,
            ping_interval=None,  # We handle keepalive manually
        )

        logger.info(
            "STT connected | Model=%s | Language=%s | API=%s | URL=%s",
            model, language, api_ver, deepgram_ws_url,
        )

    async def start(self) -> None:
        """Starts STT service with automatic connection retry."""
        max_retries = 3
        for attempt in range(1, max_retries + 1):
            try:
                await self._connect()
                break
            except Exception as exc:
                logger.error(
                    "STT connection failed (attempt %d/%d): %s", attempt, max_retries, exc
                )
                if attempt == max_retries:
                    raise
                await asyncio.sleep(0.5 * attempt)

        self._running = True
        self._tasks = [
            asyncio.create_task(self._send_loop(), name="stt-send"),
            asyncio.create_task(self._receive_loop(), name="stt-recv"),
        ]

    async def send_audio(self, mulaw_bytes: bytes) -> None:
        """Enqueue audio bytes for sending. Guards against empty frames."""
        if self._running and mulaw_bytes:
            await self._send_queue.put(mulaw_bytes)

    async def force_end_turn(self) -> None:
        """
        Immediately end the active Flux v2 turn (manual barge-in / push-to-talk).
        Only valid for v2 connections. The server emits EndOfTurn with trigger='manual'.
        Requires ForceEndTurn to be enabled on the deployment.
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
                logger.warning("STT close error (may already be closed): %s", exc)

        for task in self._tasks:
            task.cancel()

        self._tasks = []

    # -------------------------------------------------------------------------
    # Internal loops
    # -------------------------------------------------------------------------

    async def _send_loop(self) -> None:
        """
        Dequeues audio chunks and sends them to Deepgram.
        Sends a KeepAlive after ~8 seconds of silence to prevent NET-0001 timeouts.
        """
        idle_ticks = 0  # Each tick ≈ 0.5 s (the queue timeout)

        while self._running:
            try:
                chunk = await asyncio.wait_for(self._send_queue.get(), timeout=0.5)
                await self._ws.send(chunk)
                idle_ticks = 0

            except asyncio.TimeoutError:
                idle_ticks += 1
                if idle_ticks >= 16:  # 16 × 0.5 s = 8 seconds of silence
                    try:
                        await self._ws.send(json.dumps({"type": "KeepAlive"}))
                        logger.debug("STT KeepAlive sent.")
                    except Exception as exc:
                        logger.error("KeepAlive send failed: %s", exc)
                        break
                    idle_ticks = 0

            except Exception as exc:
                logger.error("STT send loop error: %s", exc)
                break

        self._running = False

    async def _receive_loop(self) -> None:
        """
        Receives and dispatches Deepgram messages.

        Flux v2 (TurnInfo):
          - StartOfTurn   → turn opened, transcription in progress
          - Update        → interim partial transcript
          - EagerEndOfTurn → early confident end-of-turn (is_final=False)
          - EndOfTurn     → confirmed final transcript (is_final=True)
                            trigger: "model" | "manual" | "timeout"
          - TurnResumed   → user continued speaking after EagerEndOfTurn

        Nova-3 v1 (Results):
          - speech_final=True → final utterance transcript
          - is_final=True     → interim final (word-stable, not utterance-final)
        """
        while self._running:
            try:
                raw = await asyncio.wait_for(self._ws.recv(), timeout=1.0)
                data = json.loads(raw)

                msg_type = data.get("type")
                event = data.get("event") or data.get("event_type")

                # ------------------------------------------------------------------
                # Flux v2: TurnInfo events
                # ------------------------------------------------------------------
                if msg_type == "TurnInfo":
                    transcript = data.get("transcript", "").strip()
                    turn_index = data.get("turn_index")
                    trigger = data.get("trigger")  # "model" | "manual" | "timeout" | None

                    if event == "StartOfTurn":
                        logger.info("Flux StartOfTurn | turn=%s", turn_index)

                    elif event == "Update":
                        # Partial/interim transcript — useful for UI streaming
                        if transcript:
                            logger.debug("Flux Update | turn=%s | '%s'", turn_index, transcript)

                    elif event == "EagerEndOfTurn":
                        # Early confident prediction — treat as non-final
                        if transcript:
                            logger.info(
                                "Flux EagerEndOfTurn | turn=%s | '%s'", turn_index, transcript
                            )
                            if self.on_transcript:
                                asyncio.create_task(
                                    self.on_transcript(transcript, is_final=False)
                                )

                    elif event == "EndOfTurn":
                        # Confirmed final transcript
                        if transcript:
                            logger.info(
                                "Flux EndOfTurn | turn=%s | trigger=%s | '%s'",
                                turn_index, trigger, transcript,
                            )
                            if self.on_transcript:
                                asyncio.create_task(
                                    self.on_transcript(transcript, is_final=True)
                                )
                        else:
                            logger.info(
                                "Flux EndOfTurn | turn=%s | trigger=%s | (empty transcript)",
                                turn_index, trigger,
                            )

                    elif event == "TurnResumed":
                        # User continued speaking after an EagerEndOfTurn — discard
                        # any action taken on the eager transcript if not yet committed.
                        logger.info("Flux TurnResumed | turn=%s — user still speaking", turn_index)

                    else:
                        logger.debug("Flux TurnInfo unknown event=%s | data=%s", event, data)

                # ------------------------------------------------------------------
                # Flux v2: Connected confirmation
                # ------------------------------------------------------------------
                elif msg_type == "Connected":
                    logger.info("Deepgram Flux v2 Connected: %s", data)

                # ------------------------------------------------------------------
                # Flux v2: Fatal error
                # ------------------------------------------------------------------
                elif msg_type == "Error":
                    code = data.get("code", "")
                    description = data.get("description", "")
                    logger.error("Deepgram server error: %s — %s", code, description)
                    if code == "UNPARSABLE_CLIENT_MESSAGE":
                        logger.error(
                            "ForceEndTurn is not enabled on this deployment. "
                            "Remove force_end_turn() calls or use a supported deployment."
                        )

                # ------------------------------------------------------------------
                # Nova-3 v1: Results events
                # ------------------------------------------------------------------
                elif msg_type == "Results":
                    channel = data.get("channel", {})
                    alternatives = channel.get("alternatives", [{}])
                    transcript = alternatives[0].get("transcript", "").strip() if alternatives else ""
                    speech_final = data.get("speech_final", False)
                    is_final = data.get("is_final", False)

                    if self.selected_digit == "1":
                        logger.info(
                            "STT [TELUGU] Nova-3 | transcript='%s' | speech_final=%s | is_final=%s",
                            transcript, speech_final, is_final,
                        )

                    if speech_final and transcript:
                        # Utterance-level final — send to agent
                        logger.info("Nova-3 speech_final | '%s'", transcript)
                        if self.on_transcript:
                            asyncio.create_task(self.on_transcript(transcript, is_final=True))
                    elif is_final and transcript:
                        # Word-stable interim — useful for partial display
                        if self.on_transcript:
                            asyncio.create_task(self.on_transcript(transcript, is_final=False))

                # ------------------------------------------------------------------
                # Nova-3 v1: Metadata / SpeechStarted / UtteranceEnd
                # ------------------------------------------------------------------
                elif msg_type == "Metadata":
                    logger.debug("STT Metadata: %s", data)

                elif msg_type == "SpeechStarted":
                    logger.debug("STT SpeechStarted detected.")

                elif msg_type == "UtteranceEnd":
                    logger.debug("STT UtteranceEnd received.")

                else:
                    logger.info("📨 STT unhandled message type=%s | %s", msg_type, data)

            except asyncio.TimeoutError:
                # Normal — no message within 1 s, loop again
                continue

            except websockets.exceptions.ConnectionClosedOK:
                logger.info("STT WebSocket closed normally.")
                break

            except websockets.exceptions.ConnectionClosedError as exc:
                logger.error("STT WebSocket closed with error: %s", exc)
                break

            except Exception as exc:
                logger.error("STT receive loop error: %s", exc)
                break

        self._running = False


async def create_stt_client(language: str = "en"):
    """Factory function to create and connect STT client."""
    client = SarvamStream(selected_digit="3")  # Default to English/Flux v2
    await client.start()
    return client
