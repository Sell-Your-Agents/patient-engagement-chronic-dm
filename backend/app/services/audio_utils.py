import struct
import asyncio
import base64
from typing import AsyncGenerator

# μ-law (u-law) encoding/decoding constants
MULAW_BIAS = 0x84
MULAW_MAX = 0x7F
MULAW_TABINIT = 1


def mulaw_encode(pcm_sample: int) -> int:
    """Encode a 16-bit PCM sample to 8-bit μ-law."""
    if pcm_sample < 0:
        pcm_sample = -pcm_sample
        sign = 0
    else:
        sign = 0x80

    pcm_sample += MULAW_BIAS
    exp = 7
    mask = 0x4000

    while (pcm_sample & mask) == 0 and exp > 0:
        exp -= 1
        mask >>= 1

    mantissa = (pcm_sample >> (exp + 3)) & 0x0F
    return sign | (exp << 4) | mantissa


def mulaw_decode(mulaw_byte: int) -> int:
    """Decode an 8-bit μ-law sample to 16-bit PCM."""
    mulaw_byte = ~mulaw_byte

    sign = mulaw_byte & 0x80
    exp = (mulaw_byte & 0x70) >> 4
    mantissa = mulaw_byte & 0x0F

    pcm = (mantissa << (exp + 3)) + (MULAW_BIAS >> (8 - exp - 1))

    if sign == 0:
        pcm = -pcm

    return pcm


def pcm_to_mulaw(pcm_data: bytes) -> bytes:
    """Convert 16-bit PCM audio to 8-bit μ-law."""
    mulaw = bytearray()
    for i in range(0, len(pcm_data), 2):
        if i + 1 < len(pcm_data):
            sample = struct.unpack("<h", pcm_data[i : i + 2])[0]
            mulaw.append(mulaw_encode(sample))
    return bytes(mulaw)


def mulaw_to_pcm(mulaw_data: bytes) -> bytes:
    """Convert 8-bit μ-law audio to 16-bit PCM."""
    pcm = bytearray()
    for byte in mulaw_data:
        sample = mulaw_decode(byte)
        pcm.extend(struct.pack("<h", sample))
    return bytes(pcm)


async def chunk_audio_for_streaming(
    audio_data: bytes,
    chunk_size: int = 160,
    frame_duration_ms: int = 20,
    sample_rate: int = 8000,
) -> AsyncGenerator[bytes, None]:
    """Chunk audio data and yield it at the proper rate for streaming.

    Args:
        audio_data: Raw audio bytes (μ-law, 8kHz)
        chunk_size: Number of bytes per chunk (160 bytes = 20ms at 8kHz)
        frame_duration_ms: Duration of each frame in milliseconds
        sample_rate: Sample rate in Hz

    Yields:
        Audio chunks at proper streaming pace
    """
    bytes_per_frame = (sample_rate // 1000) * frame_duration_ms
    for i in range(0, len(audio_data), bytes_per_frame):
        chunk = audio_data[i : i + bytes_per_frame]
        if chunk:
            yield chunk
            # Wait for the frame duration before yielding next chunk
            await asyncio.sleep(frame_duration_ms / 1000.0)


async def stream_audio_and_caption(
    audio_generator: AsyncGenerator,
    caption_generator: AsyncGenerator,
    max_concurrent_frames: int = 3,
) -> AsyncGenerator:
    """Multiplex audio and caption streams, yielding whichever is ready.

    Used to interleave TTS audio chunks with caption/subtitle updates.
    """
    # Simplified version: just yield from audio, then captions
    # A real implementation would use asyncio.gather or a queue
    async for chunk in audio_generator:
        yield ("audio", chunk)

    async for caption in caption_generator:
        yield ("caption", caption)


def decode_twilio_payload(base64_payload: str) -> bytes:
    """Decode base64-encoded audio payload from Twilio media event."""
    return base64.b64decode(base64_payload)


def encode_mulaw_for_twilio(mulaw_bytes: bytes) -> str:
    """Base64-encode µ-law bytes for Twilio WebSocket payload."""
    return base64.b64encode(mulaw_bytes).decode("utf-8")
