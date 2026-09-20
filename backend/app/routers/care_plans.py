from fastapi import APIRouter, Depends, HTTPException, status
from typing import List
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from datetime import datetime

from app.database import get_db
from app.models.care_plan import CarePlan
from app.deps import get_current_user
from app.models.care_team_user import CareTeamUser

router = APIRouter(prefix="/api/care-plans", tags=["care_plans"])


class CarePlanResponse(BaseModel):
    id: int
    patient_id: int
    followup_interval_days: int
    next_due_date: datetime
    status: str

    class Config:
        from_attributes = True


@router.get("/", response_model=List[CarePlanResponse])
async def list_care_plans(
    db: AsyncSession = Depends(get_db),
    _: CareTeamUser = Depends(get_current_user),
):
    result = await db.execute(
        select(CarePlan).where(CarePlan.status == "active").limit(100)
    )
    return result.scalars().all()
