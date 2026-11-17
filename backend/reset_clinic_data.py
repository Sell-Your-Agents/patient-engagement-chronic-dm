"""
One-time reset: remove ALL demo and test data, then load the clinic's doctors and knowledge base.

Deletes every: follow-up, appointment, call (with its transcript turns), patient, doctor,
knowledge-base entry and notification read-mark. Keeps the staff logins (users).
Then inserts the doctors and knowledge base from app/knowledge/clinic_seed.py.

It works on the database in DATABASE_URL / DATABASE_SCHEMA (.env). It cannot be undone.

Usage (from backend/):
  python reset_clinic_data.py           # shows what would be deleted, changes nothing
  python reset_clinic_data.py --yes     # deletes and reloads
On the server:
  sudo docker exec sixsigma-api python reset_clinic_data.py
  sudo docker exec sixsigma-api python reset_clinic_data.py --yes
"""
import asyncio
import re
import sys

from sqlalchemy import delete, func, select

from app.config import get_settings
from app.database import AsyncSessionLocal, init_db
from app.knowledge.clinic_seed import seed_clinic_data
from app.models.appointment import Appointment
from app.models.call_log import CallLog, CallTurn
from app.models.callback_schedule import FollowUp
from app.models.doctor import Doctor
from app.models.knowledge import ClinicKnowledge
from app.models.notification import NotificationClear, NotificationRead
from app.models.patient import Patient

# Children before parents (foreign keys)
TABLES = [
    ("notification read-marks", NotificationRead),
    ("notification clears", NotificationClear),
    ("follow-ups", FollowUp),
    ("appointments", Appointment),
    ("call transcript turns", CallTurn),
    ("calls", CallLog),
    ("patients", Patient),
    ("doctors", Doctor),
    ("knowledge-base entries", ClinicKnowledge),
]


def _where() -> str:
    settings = get_settings()
    host = re.sub(r"^.*@", "", settings.database_url).split("/")[0] or settings.database_url.split("://")[0]
    return f"{host}, schema \"{settings.database_schema or 'default'}\""


async def main(confirmed: bool) -> None:
    await init_db()
    print(f"Database: {_where()}")
    async with AsyncSessionLocal() as db:
        for label, model in TABLES:
            count = (await db.execute(select(func.count()).select_from(model))).scalar()
            print(f"  {label:<26} {count}")
        if not confirmed:
            print("\nNothing changed. Run again with --yes to delete all of the above and load the clinic data.")
            return
        for _, model in TABLES:
            await db.execute(delete(model))
        await db.commit()
        print("[ok] Demo and test data deleted (staff logins kept)")
        await seed_clinic_data(db)
        doctors = (await db.execute(select(func.count()).select_from(Doctor))).scalar()
        knowledge = (await db.execute(select(func.count()).select_from(ClinicKnowledge))).scalar()
        print(f"[ok] Loaded {doctors} doctors and {knowledge} knowledge-base entries")


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main("--yes" in sys.argv))
