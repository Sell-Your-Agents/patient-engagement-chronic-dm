"""Public URLs as Twilio sees them.

Behind a reverse proxy the app may be served under a path prefix
(e.g. https://callingapp-dev.zensark.com/patientpulse-api) that the proxy strips before the
request reaches FastAPI. Twilio signs requests and opens media websockets using the *public*
URL, so both must be built from settings.api_base_url rather than from the incoming request.
"""
from fastapi import Request

from app.config import get_settings

settings = get_settings()


def public_request_url(request: Request) -> str:
    """The URL Twilio called (and signed), e.g. https://host/prefix/twilio/twiml."""
    url = f"{settings.api_base_url.rstrip('/')}{request.url.path}"
    if request.url.query:
        url += f"?{request.url.query}"
    return url


def public_ws_url(path: str) -> str:
    """Websocket URL for a backend path, e.g. wss://host/prefix/twilio/stream/CA123."""
    base = settings.api_base_url.rstrip("/")
    if base.startswith("https://"):
        base = "wss://" + base[len("https://"):]
    elif base.startswith("http://"):
        base = "ws://" + base[len("http://"):]
    return f"{base}{path}"
