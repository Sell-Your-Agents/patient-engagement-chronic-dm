from datetime import datetime, timedelta
from typing import Optional
from passlib.context import CryptContext
from jose import jwt, JWTError
from app.config import get_settings

settings = get_settings()

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

ACCESS = "access"
REFRESH = "refresh"


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def _encode(data: dict, token_type: str, expires_delta: timedelta) -> str:
    to_encode = {**data, "type": token_type, "exp": datetime.utcnow() + expires_delta}
    return jwt.encode(to_encode, settings.jwt_secret_key, algorithm=settings.algorithm)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    return _encode(data, ACCESS, expires_delta or timedelta(minutes=settings.access_token_expire_minutes))


def create_refresh_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    return _encode(data, REFRESH, expires_delta or timedelta(minutes=settings.refresh_token_expire_minutes))


def _decode(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.algorithm])


def decode_access_token(token: str) -> dict:
    """Decode a token that authorises an API call. Refresh tokens are refused here."""
    payload = _decode(token)
    if payload.get("type") == REFRESH:
        raise JWTError("Refresh token used as an access token")
    return payload


def decode_refresh_token(token: str) -> dict:
    """Decode a token presented to /auth/refresh. Only refresh tokens are accepted."""
    payload = _decode(token)
    if payload.get("type") != REFRESH:
        raise JWTError("Not a refresh token")
    return payload
