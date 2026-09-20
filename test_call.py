"""
Test the refactored WebSocket call handler.
Simulates Twilio WebSocket events.
"""
import asyncio
import json
import base64
from sqlalchemy import select
from app.database import AsyncSessionLocal
from app.models.outreach_call import OutreachCall
from app.models.care_team_user import CareTeamUser

async def test():
    async with AsyncSessionLocal() as db:
        # Get test user
        result = await db.execute(select(CareTeamUser).limit(1))
        user = result.scalar_one_or_none()
        if not user:
            print("No test user found")
            return
        
        print(f"Test user: {user.email}")
        
        # Get a test outreach call or care plan to trigger
        result = await db.execute(select(OutreachCall).limit(1))
        call = result.scalar_one_or_none()
        if call:
            print(f"Found test call: {call.call_sid}")
        else:
            print("No test calls found - would need to create one")

asyncio.run(test())
