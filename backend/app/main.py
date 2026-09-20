import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import init_db, get_db
from app.config import get_settings

settings = get_settings()

# Configure logging
LOGS_DIR = Path(__file__).resolve().parent.parent / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOGS_DIR / "app.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
    ],
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Initializing database...")
    await init_db()
    logger.info("Database initialized")

    # Background scheduler task will be started here in Phase 3
    # scheduler_task = asyncio.create_task(run_outreach_scheduler())

    yield

    # Shutdown
    logger.info("Application shutting down...")


app = FastAPI(
    title=settings.app_name,
    description="Agentic AI for proactive patient engagement in chronic disease management",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Logging middleware
@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log all HTTP requests and responses."""
    start_time = time.time()

    # Skip logging for health checks
    if request.url.path == "/health":
        response = await call_next(request)
        return response

    # Log incoming request
    logger.info(f"REQ {request.method} {request.url.path}")

    try:
        response = await call_next(request)
        process_time = time.time() - start_time

        # Log response
        status_marker = "OK" if response.status_code < 400 else "ERR"
        logger.info(f"RESP {request.method} {request.url.path} -> {response.status_code} ({process_time:.2f}s) [{status_marker}]")

        return response
    except Exception as e:
        logger.error(f"EXCEPTION {request.method} {request.url.path}: {e}", exc_info=True)
        raise


# Import and include routers
from app.routers import (
    auth,
    patients,
    conditions,
    care_plans,
    outreach_calls,
    twilio_webhook,
    escalations,
    appointments,
    medication_reminders,
    analytics,
)

app.include_router(auth.router)
app.include_router(patients.router)
app.include_router(conditions.router)
app.include_router(care_plans.router)
app.include_router(outreach_calls.router)
app.include_router(twilio_webhook.router)
app.include_router(escalations.router)
app.include_router(appointments.router)
app.include_router(medication_reminders.router)
app.include_router(analytics.router)


@app.get("/", include_in_schema=False)
async def root():
    return {
        "message": "Patient Engagement for Chronic Disease Management API",
        "docs": "/docs",
    }


@app.get("/health")
async def health():
    return {"status": "ok", "service": "patient-engagement-api"}


@app.get("/api/debug/users", include_in_schema=False)
async def debug_users(db: AsyncSession = Depends(get_db)):
    from app.models.care_team_user import CareTeamUser
    result = await db.execute(select(CareTeamUser))
    users = result.scalars().all()
    return {
        "user_count": len(users),
        "users": [{"id": u.id, "email": u.email, "is_active": u.is_active} for u in users]
    }


@app.get("/api/debug/care-plans", include_in_schema=False)
async def debug_care_plans(db: AsyncSession = Depends(get_db)):
    from app.models.care_plan import CarePlan
    from app.models.patient import Patient
    result = await db.execute(select(CarePlan))
    plans = result.scalars().all()
    return {
        "care_plan_count": len(plans),
        "care_plans": [
            {"id": p.id, "patient_id": p.patient_id, "status": p.status} for p in plans
        ]
    }
