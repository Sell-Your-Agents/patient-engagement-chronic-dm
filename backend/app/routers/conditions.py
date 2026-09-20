from fastapi import APIRouter, Depends
from typing import List
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.database import get_db
from app.models.condition import ChronicCondition
from app.deps import get_current_user, require_role
from app.models.care_team_user import CareTeamUser

router = APIRouter(prefix="/api/conditions", tags=["conditions"])


class ConditionResponse(BaseModel):
    id: int
    code: str
    display_name: str
    is_active: bool

    class Config:
        from_attributes = True


@router.get("/", response_model=List[ConditionResponse])
async def list_conditions(
    db: AsyncSession = Depends(get_db),
    _: CareTeamUser = Depends(get_current_user),
):
    result = await db.execute(
        select(ChronicCondition).where(ChronicCondition.is_active == True)
    )
    return result.scalars().all()
