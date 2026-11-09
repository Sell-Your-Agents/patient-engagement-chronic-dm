"""Add the new red flags (hypoglycemia, stroke_signs, ...) to protocols already in a database.

The app never changes protocols by itself. Run this by hand, and only when you mean to.

    cd backend
    python scripts/sync_protocols.py            # DRY RUN: shows what would change, writes nothing
    python scripts/sync_protocols.py --apply    # writes the changes (take a database backup first)

It uses DATABASE_URL from backend/.env (or the environment). It only adds red flags whose id is
missing and rewords questions by id; intervals, call times and staff edits are left alone.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.engine import make_url  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.database import AsyncSessionLocal  # noqa: E402
from app.knowledge.seed_protocols import sync_protocol_content  # noqa: E402


async def main(apply: bool) -> None:
    url = make_url(get_settings().database_url)
    print(f"Database: {url.drivername} {url.host or ''}/{url.database}")
    print("Mode: APPLY (will write)" if apply else "Mode: DRY RUN (nothing is written)")
    async with AsyncSessionLocal() as db:
        changes = await sync_protocol_content(db, apply=apply)
    if not changes:
        print("Protocols are already up to date. Nothing to do.")
        return
    for change in changes:
        print(" -", change)
    print(f"{len(changes)} change(s) {'written' if apply else 'would be made; run again with --apply to write them'}.")


if __name__ == "__main__":
    apply = "--apply" in sys.argv[1:]
    if apply:
        answer = input("This writes to the database above. Type YES to continue: ")
        if answer.strip() != "YES":
            print("Cancelled. Nothing was written.")
            sys.exit(0)
    asyncio.run(main(apply))
