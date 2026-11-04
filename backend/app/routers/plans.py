from fastapi import APIRouter, Depends
from typing import List
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from datetime import datetime

from app.database import get_db
from app.models.plan import Plan
from app.deps import get_current_user
from app.models.user import User

router = APIRouter(prefix="/api/plans", tags=["plans"])


class PlanResponse(BaseModel):
    id: int
    patient_id: int
    followup_interval_days: int
    next_due_date: datetime
    status: str

    class Config:
        from_attributes = True


@router.get("/", response_model=List[PlanResponse])
async def list_plans(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Plan).where(Plan.status == "active").limit(100)
    )
    return result.scalars().all()
