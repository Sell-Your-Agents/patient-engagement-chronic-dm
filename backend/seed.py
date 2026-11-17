"""
Initial database setup for a new, empty database (safe to run again: it skips what exists).

Creates:
  1. All tables
  2. Demo clinic staff user  - test@hospital.com / TestPass123! (role: clinic_staff)
  3. The clinic's doctors and knowledge base (app/knowledge/clinic_seed.py), only into empty
     tables. The doctors' working hours are placeholders: set the real ones on the Doctors page.
     To replace old demo data in an existing database, run reset_clinic_data.py instead.

Usage (from backend/):  .\\venv\\Scripts\\python.exe seed.py
"""
import asyncio
import sys

from sqlalchemy import select

from app.auth.security import hash_password
from app.database import AsyncSessionLocal, init_db
from app.knowledge.clinic_seed import seed_clinic_data
from app.models.user import User

DEMO_EMAIL = "test@hospital.com"
DEMO_PASSWORD = "TestPass123!"


async def seed_database():
    await init_db()
    print("[ok] Tables created")

    async with AsyncSessionLocal() as db:
        existing = (await db.execute(select(User).where(User.email == DEMO_EMAIL))).scalar_one_or_none()
        if existing is None:
            db.add(
                User(
                    name="Clinic Front Desk",
                    email=DEMO_EMAIL,
                    hashed_password=hash_password(DEMO_PASSWORD),
                    role="clinic_staff",
                )
            )
            await db.commit()
            print(f"[ok] Demo user created: {DEMO_EMAIL} / {DEMO_PASSWORD}")
        else:
            print("[ok] Demo user already exists")

        await seed_clinic_data(db)
        print("[ok] Doctors and clinic knowledge base ready")


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(seed_database())
