from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import logging
from app.database import get_db
from app.security import decode_access_token
from app.models.care_team_user import CareTeamUser
from jose import JWTError

logger = logging.getLogger(__name__)
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


async def get_current_user(
    token: str = Depends(oauth2_scheme), db: AsyncSession = Depends(get_db)
) -> CareTeamUser:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        logger.debug(f"Token validation started: {token[:50]}...")
        payload = decode_access_token(token)
        logger.debug(f"Token decoded: {payload}")
        user_id: int = int(payload.get("sub"))
        logger.debug(f"User ID from token: {user_id}")
        if user_id is None:
            logger.warning("No user_id in token")
            raise credentials_exception
    except JWTError as e:
        logger.warning(f"JWT Error: {e}")
        raise credentials_exception

    result = await db.execute(select(CareTeamUser).where(CareTeamUser.id == user_id))
    user = result.scalar_one_or_none()
    logger.debug(f"User from DB: {user}")
    if user is None or not user.is_active:
        logger.warning(f"User not found or inactive")
        raise credentials_exception
    logger.info(f"User validated: {user.email}")
    return user


def require_role(*roles: str):
    async def check_role(current_user: CareTeamUser = Depends(get_current_user)):
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return current_user

    return check_role
