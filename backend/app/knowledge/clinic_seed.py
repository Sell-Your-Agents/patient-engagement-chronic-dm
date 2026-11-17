"""Starting data for Six Sigma Clinic: doctor profiles and the clinic knowledge base.

DEMO DATA. Replace it with the clinic's approved information (Doctors and Clinic Knowledge pages
in the dashboard) before going live: the agent tells callers exactly what is written here.
Inserted once, when the tables are empty (FastAPI startup and seed.py).
"""
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.doctor import Doctor
from app.models.knowledge import ClinicKnowledge

logger = logging.getLogger(__name__)

DEMO_DOCTORS = [
    {
        "name": "Dr. Ramesh Agarwal",
        "specialty": "General Physician",
        "qualification": "MBBS, MD (General Medicine)",
        "treats": "fever, cold, cough, infections, body pain, blood pressure and sugar check-ups, general health concerns",
        "working_days": [0, 1, 2, 3, 4, 5],
        "start_time": "10:00",
        "end_time": "19:00",
        "slot_minutes": 15,
        "languages": "English, Hindi, Telugu",
    },
    {
        "name": "Dr. Kavitha Reddy",
        "specialty": "Cardiologist",
        "qualification": "MBBS, MD, DM (Cardiology)",
        "treats": "heart problems, chest discomfort on exertion, palpitations, high blood pressure follow-up",
        "working_days": [1, 3, 5],
        "start_time": "10:00",
        "end_time": "13:00",
        "slot_minutes": 20,
        "languages": "English, Telugu",
    },
    {
        "name": "Dr. Priya Menon",
        "specialty": "Orthopaedics",
        "qualification": "MBBS, MS (Orthopaedics)",
        "treats": "bone, joint, knee, back and neck pain, fractures, sprains, arthritis",
        "working_days": [0, 2, 4],
        "start_time": "14:00",
        "end_time": "17:00",
        "slot_minutes": 20,
        "languages": "English, Hindi",
    },
    {
        "name": "Dr. Anjali Sharma",
        "specialty": "Gynaecologist",
        "qualification": "MBBS, MS (Obstetrics and Gynaecology)",
        "treats": "women's health, pregnancy care, periods-related problems",
        "working_days": [0, 1, 3, 4],
        "start_time": "11:00",
        "end_time": "14:00",
        "slot_minutes": 20,
        "languages": "English, Hindi",
    },
    {
        "name": "Dr. Sameer Khan",
        "specialty": "Paediatrician",
        "qualification": "MBBS, MD (Paediatrics)",
        "treats": "children's health, vaccinations, fever and infections in children",
        "working_days": [0, 1, 2, 3, 4, 5],
        "start_time": "16:00",
        "end_time": "19:00",
        "slot_minutes": 15,
        "languages": "English, Hindi, Telugu",
    },
]

DEMO_KNOWLEDGE = [
    ("service", "General physician consultations", "Consultations with a general physician for common illnesses and routine check-ups, Monday to Saturday."),
    ("service", "Specialist consultations", "Cardiology, orthopaedics, gynaecology and paediatrics consultations on the days listed for each doctor."),
    ("service", "Laboratory tests", "Blood and urine tests are collected at the clinic from 8 AM to 11 AM, Monday to Saturday."),
    ("service", "ECG", "ECG is available at the clinic during consultation hours."),
    ("faq", "Do I need an appointment?", "Appointments are recommended so the doctor can see you on time. Walk-in patients are seen when a slot is free."),
    ("faq", "What should I bring to my appointment?", "Please bring any earlier prescriptions, test reports and a photo ID."),
    ("faq", "Is the clinic open on Sundays?", "The clinic is closed on Sundays."),
    ("policy", "Changing or cancelling an appointment", "Please call the clinic at least two hours before your appointment to change or cancel it."),
]


async def seed_clinic_data(db: AsyncSession) -> None:
    """Insert the demo doctors and knowledge base once (each only if its table is empty)."""
    if (await db.execute(select(Doctor.id).limit(1))).scalar_one_or_none() is None:
        for data in DEMO_DOCTORS:
            db.add(Doctor(**data))
        logger.info("Seeded %d demo doctor schedules", len(DEMO_DOCTORS))
    if (await db.execute(select(ClinicKnowledge.id).limit(1))).scalar_one_or_none() is None:
        for order, (category, title, content) in enumerate(DEMO_KNOWLEDGE):
            db.add(ClinicKnowledge(category=category, title=title, content=content, sort_order=order))
        logger.info("Seeded %d clinic knowledge entries", len(DEMO_KNOWLEDGE))
    await db.commit()
