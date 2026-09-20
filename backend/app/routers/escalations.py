from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from datetime import datetime
from typing import List, Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user
from app.models.care_team_user import CareTeamUser
from app.models.escalation_case import EscalationCase

router = APIRouter(prefix="/api/escalations", tags=["escalations"])


class EscalationResponse(BaseModel):
    id: int
    outreach_call_id: int
    patient_id: int
    reason: str
    severity: str
    status: str
    assigned_to_user_id: Optional[int]
    resolution_notes: Optional[str]
    created_at: datetime
    acknowledged_at: Optional[datetime]
    resolved_at: Optional[datetime]

    class Config:
        from_attributes = True


class EscalationUpdateRequest(BaseModel):
    status: Optional[str] = None
    assigned_to_user_id: Optional[int] = None
    resolution_notes: Optional[str] = None


@router.get("/", response_model=List[EscalationResponse])
async def list_escalations(
    db: AsyncSession = Depends(get_db),
    _: CareTeamUser = Depends(get_current_user),
    status: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
) -> List[EscalationResponse]:
    """List escalation cases with optional filters."""
    query = select(EscalationCase)

    if status:
        query = query.where(EscalationCase.status == status)

    if severity:
        query = query.where(EscalationCase.severity == severity)

    query = query.offset(skip).limit(limit)
    result = await db.execute(query)
    cases = result.scalars().all()

    return [EscalationResponse.model_validate(case) for case in cases]


@router.get("/{id}", response_model=EscalationResponse)
async def get_escalation(
    id: int,
    db: AsyncSession = Depends(get_db),
    _: CareTeamUser = Depends(get_current_user),
) -> EscalationResponse:
    """Get details of a specific escalation case."""
    result = await db.execute(
        select(EscalationCase).where(EscalationCase.id == id)
    )
    case = result.scalar_one_or_none()

    if not case:
        raise HTTPException(status_code=404, detail="Escalation case not found")

    return EscalationResponse.model_validate(case)


@router.patch("/{id}", response_model=EscalationResponse)
async def update_escalation(
    id: int,
    request: EscalationUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: CareTeamUser = Depends(get_current_user),
) -> EscalationResponse:
    """Update an escalation case (assign, resolve, etc.)."""
    result = await db.execute(
        select(EscalationCase).where(EscalationCase.id == id)
    )
    case = result.scalar_one_or_none()

    if not case:
        raise HTTPException(status_code=404, detail="Escalation case not found")

    # Update fields
    if request.status:
        case.status = request.status
        if request.status == "resolved":
            case.resolved_at = datetime.utcnow()
        elif request.status == "acknowledged":
            case.acknowledged_at = datetime.utcnow()

    if request.assigned_to_user_id is not None:
        case.assigned_to_user_id = request.assigned_to_user_id

    if request.resolution_notes:
        case.resolution_notes = request.resolution_notes

    await db.commit()
    await db.refresh(case)

    return EscalationResponse.model_validate(case)


@router.get("/stats/summary", response_model=dict)
async def escalation_stats(
    db: AsyncSession = Depends(get_db),
    _: CareTeamUser = Depends(get_current_user),
) -> dict:
    """Get escalation statistics."""
    from sqlalchemy import func

    # Total escalations
    total_result = await db.execute(select(func.count(EscalationCase.id)))
    total = total_result.scalar() or 0

    # Open escalations
    open_result = await db.execute(
        select(func.count(EscalationCase.id)).where(EscalationCase.status == "open")
    )
    open_count = open_result.scalar() or 0

    # Urgent severity
    urgent_result = await db.execute(
        select(func.count(EscalationCase.id)).where(
            EscalationCase.severity == "urgent"
        )
    )
    urgent_count = urgent_result.scalar() or 0

    return {
        "total_escalations": total,
        "open_escalations": open_count,
        "urgent_cases": urgent_count,
    }
