import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db
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

    from app.database import AsyncSessionLocal
    from app.knowledge.clinic_seed import seed_clinic_data
    from app.services.agent.call_cleanup import close_stale_calls

    # Demo doctor schedules and knowledge base (only inserted into empty tables)
    async with AsyncSessionLocal() as db:
        await seed_clinic_data(db)

    # Calls left "live" by a restart (their audio stream died with the old process)
    async with AsyncSessionLocal() as db:
        closed = await close_stale_calls(db, browser_only_any_age=True)
        if closed:
            logger.info(f"Closed {closed} call(s) left in progress by a previous run")

    yield

    # Shutdown
    logger.info("Application shutting down...")


app = FastAPI(
    title=settings.app_name,
    description="AI calling agent for clinics: answers calls, records appointment requests and callbacks",
    version="1.0.0",
    lifespan=lifespan,
    root_path=settings.root_path,
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
    calls,
    followups,
    twilio_webhook,
    appointments,
    analytics,
    clinic,
    clinic_twilio,
    browser_call,
    sim_call,
    notifications,
)

app.include_router(auth.router)
app.include_router(patients.router)
app.include_router(calls.router)
app.include_router(followups.router)
app.include_router(twilio_webhook.router)
app.include_router(appointments.router)
app.include_router(analytics.router)
app.include_router(clinic.router)
app.include_router(clinic_twilio.router)
app.include_router(browser_call.router)
app.include_router(sim_call.router)
app.include_router(notifications.router)


@app.get("/", include_in_schema=False)
async def root():
    return {
        "message": f"{settings.app_name} API",
        "docs": "/docs",
    }


@app.get("/health")
async def health():
    return {"status": "ok", "service": "clinic-calling-agent-api"}
