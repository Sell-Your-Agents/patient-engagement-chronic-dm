from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Literal, Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field
from datetime import datetime, timezone

from app.database import get_db
from app.models.plan import Plan
from app.auth.deps import get_current_user
from app.models.user import User

router = APIRouter(prefix="/api/plans", tags=["plans"])


class PlanResponse(BaseModel):
    id: int
    patient_id: int
    followup_interval_days: int
    followup_interval_minutes: Optional[int] = None
    next_due_date: datetime
    status: str

    class Config:
        from_attributes = True


class PlanUpdate(BaseModel):
    followup_interval_days: Optional[int] = Field(None, ge=1, le=365)
    # Repeat every N minutes instead of days; null goes back to days
    followup_interval_minutes: Optional[int] = Field(None, ge=1, le=1440)
    next_due_date: Optional[datetime] = None
    status: Optional[Literal["active", "paused", "completed"]] = None
    assigned_physician_name: Optional[str] = Field(None, max_length=120)
    notes: Optional[str] = None


@router.get("/", response_model=List[PlanResponse])
async def list_plans(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Plan).where(Plan.status == "active").limit(100)
    )
    return result.scalars().all()


@router.patch("/{plan_id}", response_model=PlanResponse)
async def update_plan(
    plan_id: int,
    plan_data: PlanUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    plan = (await db.execute(select(Plan).where(Plan.id == plan_id))).scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")

    update_data = plan_data.model_dump(exclude_unset=True)
    due = update_data.get("next_due_date")
    if due is not None and due.tzinfo is not None:
        # Plan dates are stored as naive UTC
        update_data["next_due_date"] = due.astimezone(timezone.utc).replace(tzinfo=None)
    for field, value in update_data.items():
        if value is None and field in ("followup_interval_days", "next_due_date", "status"):
            continue
        setattr(plan, field, value)
    plan.adjusted_by_user_id = current_user.id

    await db.commit()
    await db.refresh(plan)
    return plan
