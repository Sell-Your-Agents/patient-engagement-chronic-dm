import base64


def decode_twilio_payload(base64_payload: str) -> bytes:
    """Decode base64-encoded audio payload from Twilio media event."""
    return base64.b64decode(base64_payload)


def encode_mulaw_for_twilio(mulaw_bytes: bytes) -> str:
    """Base64-encode µ-law bytes for Twilio WebSocket payload."""
    return base64.b64encode(mulaw_bytes).decode("utf-8")
