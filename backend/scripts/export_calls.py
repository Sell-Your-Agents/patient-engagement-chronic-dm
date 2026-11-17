"""Export call records to CSV for the clinic to review offline.

Usage (from backend/):
    .\\venv\\Scripts\\python.exe -m scripts.export_calls              # last 30 days -> calls.csv
    .\\venv\\Scripts\\python.exe -m scripts.export_calls --days 7 --out week.csv
"""
import argparse
import asyncio
import csv
import sys
from datetime import datetime, timedelta

from sqlalchemy import select

from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models.call_log import CallLog, call_ref

COLUMNS = [
    ("Call ID", lambda c: call_ref(c.id)),
    ("Date (clinic time)", None),
    ("Caller", lambda c: c.patient_name or ""),
    ("Contact", lambda c: c.phone_number or ""),
    ("Language", lambda c: c.language or ""),
    ("Intent", lambda c: (c.intent or "").replace("_", " ")),
    ("Doctor", lambda c: c.doctor_requested or ""),
    ("Preferred slot", lambda c: c.preferred_slot or ""),
    ("Call outcome", lambda c: c.outcome or ""),
    ("Booking status", lambda c: (c.booking_status or "").replace("_", " ")),
    ("Next action", lambda c: c.next_action or ""),
    ("Duration (s)", lambda c: c.duration_seconds or ""),
    ("Summary", lambda c: c.summary or ""),
]


async def export(days: int, out: str) -> int:
    offset = timedelta(minutes=get_settings().clinic_utc_offset_minutes)
    since = datetime.utcnow() - timedelta(days=days)
    async with AsyncSessionLocal() as db:
        calls = (await db.execute(select(CallLog).where(CallLog.created_at >= since).order_by(CallLog.id))).scalars().all()
    with open(out, "w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.writer(handle)
        writer.writerow([name for name, _ in COLUMNS])
        for call in calls:
            when = ((call.started_at or call.created_at) + offset).strftime("%Y-%m-%d %H:%M")
            writer.writerow([when if get is None else get(call) for _, get in COLUMNS])
    return len(calls)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--out", default="calls.csv")
    args = parser.parse_args()
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    count = asyncio.run(export(args.days, args.out))
    print(f"Wrote {count} call(s) to {args.out}")
