"""Records a call on our own server: the caller's audio and the agent's voice, mixed into one WAV file.

Both sides of every call already pass through the backend (caller audio in from Twilio or the
browser test page, agent audio out from the text-to-speech service), so recording here works the
same for real phone calls and for "Call the Agent" test calls, whatever the voice provider is.

Timing: the caller's 20 ms frames arrive in real time and are laid down one after another. The
agent's audio is sent faster than real time and buffered by the phone, so each chunk is placed at
the moment it starts playing. When the caller talks over the agent (barge-in), the agent audio
that was never played is cut, so the file sounds like what the caller actually heard.

Not recorded: the part of a call after it was transferred to a person at the front desk (that
conversation does not pass through the backend).
"""
import asyncio
import audioop
import logging
import wave
from pathlib import Path
from typing import Optional

from app.config import get_settings

logger = logging.getLogger(__name__)

SAMPLE_RATE = 8000
SAMPLE_WIDTH = 2  # 16-bit PCM in the file (browsers play it everywhere)
# A caller frame more than this far from where the clock says it belongs is placed by the clock
# (a network pause); smaller differences are normal jitter and are ignored.
MAX_DRIFT_SAMPLES = SAMPLE_RATE // 2


def recordings_dir() -> Path:
    path = Path(get_settings().recordings_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


def recording_path(call_id: int) -> Path:
    return recordings_dir() / f"call-{call_id}.wav"


class CallRecorder:
    """Collects one call's audio in memory (about 1 MB per minute) and writes it when the call ends."""

    def __init__(self, started_at: float):
        self._t0 = started_at  # event-loop time of the stream start
        self._caller = bytearray()  # 16-bit PCM
        self._caller_pos: Optional[int] = None  # sample where the next caller frame goes
        self._agent = bytearray()  # 16-bit PCM

    def _sample(self, loop_time: float) -> int:
        return max(0, int((loop_time - self._t0) * SAMPLE_RATE))

    @staticmethod
    def _put(track: bytearray, at_sample: int, pcm: bytes) -> None:
        start = at_sample * SAMPLE_WIDTH
        end = start + len(pcm)
        if len(track) < end:
            track.extend(b"\x00" * (end - len(track)))
        track[start:end] = pcm

    def add_caller(self, mulaw: bytes, now: float) -> None:
        """A frame of the caller's audio (8 kHz mu-law), as it arrives."""
        if not mulaw:
            return
        clock = self._sample(now)
        if self._caller_pos is None or abs(clock - self._caller_pos) > MAX_DRIFT_SAMPLES:
            self._caller_pos = clock
        self._put(self._caller, self._caller_pos, audioop.ulaw2lin(mulaw, SAMPLE_WIDTH))
        self._caller_pos += len(mulaw)

    def add_agent(self, mulaw: bytes, plays_at: float) -> None:
        """Agent audio (8 kHz mu-law) that starts playing to the caller at loop time plays_at."""
        if mulaw:
            self._put(self._agent, self._sample(plays_at), audioop.ulaw2lin(mulaw, SAMPLE_WIDTH))

    def cut_agent(self, now: float) -> None:
        """Barge-in: the agent audio after now was dropped and never heard."""
        del self._agent[self._sample(now) * SAMPLE_WIDTH:]

    def _mixed(self) -> bytes:
        length = max(len(self._caller), len(self._agent))
        caller = bytes(self._caller) + b"\x00" * (length - len(self._caller))
        agent = bytes(self._agent) + b"\x00" * (length - len(self._agent))
        return audioop.add(caller, agent, SAMPLE_WIDTH)

    def _write(self, path: Path) -> int:
        audio = self._mixed()
        with wave.open(str(path), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(SAMPLE_WIDTH)
            wav.setframerate(SAMPLE_RATE)
            wav.writeframes(audio)
        return len(audio) // SAMPLE_WIDTH // SAMPLE_RATE

    async def save(self, call_id: int) -> Optional[Path]:
        """Write the recording to disk. None if there was no audio or it could not be written."""
        if not self._caller and not self._agent:
            return None
        path = recording_path(call_id)
        try:
            seconds = await asyncio.to_thread(self._write, path)
        except Exception as exc:
            logger.error(f"Could not save the recording of call #{call_id}: {exc}")
            return None
        logger.info(f"Recording of call #{call_id} saved ({seconds}s): {path}")
        return path
