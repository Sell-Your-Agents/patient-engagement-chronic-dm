"""
Create a user, or reset the password/name/role of an existing one (matched by email).
The password is hashed with the app's own hash_password(), so login works normally.

Usage (from backend/):
  .\\venv\\Scripts\\python.exe create_user.py --email new@clinic.com --password "S3cret!" --name "New User"
  Optional: --role clinic_staff (default)
"""
import argparse
import asyncio
import sys

from sqlalchemy import select

from app.auth.security import hash_password
from app.database import AsyncSessionLocal
from app.models.user import User


async def main(email: str, password: str, name: str, role: str):
    async with AsyncSessionLocal() as db:
        user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if user is None:
            db.add(User(name=name, email=email, hashed_password=hash_password(password), role=role))
            print(f"[ok] Created user {email} (role: {role})")
        else:
            user.name = name
            user.role = role
            user.hashed_password = hash_password(password)
            user.is_active = True
            print(f"[ok] Updated existing user {email}")
        await db.commit()


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--email", required=True)
    p.add_argument("--password", required=True)
    p.add_argument("--name", default="Clinic Staff")
    p.add_argument("--role", default="clinic_staff")
    a = p.parse_args()
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main(a.email, a.password, a.name, a.role))
