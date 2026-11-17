"""Starting data for Six Sigma - Prabhath Medical Center, Kondapur: doctors and the clinic knowledge base.

From the clinic's preliminary information sheet (gathered from online listings; to be verified with
the clinic). The doctors' working days and hours are PLACEHOLDERS until the clinic sends the real
schedules: change them on the Doctors page. Not included on purpose: the clinic's mobile number and
email (not to be given out by the agent), fees, holidays, insurance and facilities (still pending
from the clinic; the agent offers a callback when asked).

Inserted once, when the tables are empty (FastAPI startup and seed.py). To replace data that is
already in a database, run reset_clinic_data.py.
"""
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.doctor import Doctor
from app.models.knowledge import ClinicKnowledge

logger = logging.getLogger(__name__)

MON_SAT = [0, 1, 2, 3, 4, 5]

# Working days: 0 = Monday ... 6 = Sunday. Hours are clinic time (24-hour). PLACEHOLDER schedules.
CLINIC_DOCTORS = [
    {
        "name": "Dr. K Prabhath Kiran Reddy",
        "specialty": "General Medicine",
        "qualification": "MD (General Medicine)",
        "treats": "fever, cold and cough, infections, body pain, blood pressure, diabetes, general health check-ups",
        "working_days": MON_SAT,
        "start_time": "10:00",
        "end_time": "14:00",
    },
    {
        "name": "Dr. V Krishna Prasad",
        "specialty": "Pediatrics",
        "qualification": "MBBS, DCH",
        "treats": "children's health, fever and infections in children, growth and development, vaccinations",
        "working_days": MON_SAT,
        "start_time": "17:00",
        "end_time": "21:00",
    },
    {
        "name": "Dr. A Kranthi Kiran",
        "specialty": "Orthopedics",
        "qualification": "MBBS, MS (Orthopedics)",
        "treats": "bone and joint problems, knee, back and neck pain, fractures, sprains, arthritis",
        "working_days": [0, 2, 4],
        "start_time": "11:00",
        "end_time": "16:00",
    },
    {
        "name": "Dr. DVS Pratap",
        "specialty": "Dermatology",
        "qualification": "MD, DD",
        "treats": "skin, hair and nail problems, rashes, allergies, acne",
        "working_days": [1, 3, 5],
        "start_time": "16:00",
        "end_time": "20:00",
    },
    {
        "name": "Dr. Annapurna P",
        "specialty": "Obstetrics & Gynaecology",
        "qualification": "MBBS, DGO",
        "treats": "women's health, pregnancy care, period-related problems",
        "working_days": [0, 1, 2, 3, 4],
        "start_time": "10:00",
        "end_time": "13:00",
    },
    {
        "name": "Dr. P Sai Kumar",
        "specialty": "Physiotherapy",
        "qualification": "BPT (Apollo)",
        "treats": "physiotherapy for pain, injuries, stiffness and recovery after surgery or fractures",
        "working_days": MON_SAT,
        "start_time": "07:00",
        "end_time": "11:00",
    },
]

# (category, title, content): the agent answers clinic questions only from these and the doctors list
CLINIC_KNOWLEDGE = [
    ("faq", "About the clinic", "Six Sigma - Prabhath Medical Center is a multi-specialty clinic in Kondapur, Hyderabad."),
    ("faq", "Clinic address", "Plot 342, Raja Rajeshwari Nagar, High Tension Wire Road, Kondapur, Hyderabad 500084."),
    ("faq", "Clinic timings", "The clinic is open from 7 AM to 11 PM. Each doctor sees patients only during their own working hours (see the doctors list). Weekly holidays are not listed yet."),
    ("service", "General Medicine", "Consultations for fever, infections, blood pressure, diabetes and other general health problems."),
    ("service", "Pediatrics", "Child health consultations: illnesses in children, growth and development."),
    ("service", "Orthopedics", "Bone and joint care: joint, back and neck pain, fractures, sprains and arthritis."),
    ("service", "Dermatology", "Skin, hair and nail problems."),
    ("service", "Obstetrics & Gynaecology", "Women's health and pregnancy care."),
    ("service", "Physiotherapy", "Physiotherapy for pain, injuries, stiffness and recovery after surgery or fractures."),
    ("service", "Surgical Gastroenterology", "Listed as a clinic service, but the consultant's name and timings are not confirmed yet. Do not book it with a doctor: take the caller's name and number and the clinic team will call back with the details."),
    ("policy", "How appointments work", "There are no fixed appointment slots. Patients choose a day and a rough time within the doctor's working hours and come any time within those hours. The AI assistant records the request and the clinic team confirms it."),
    ("policy", "Moving or cancelling an appointment", "Patients can call this number to move or cancel an upcoming appointment. For privacy, this works only when they call from the phone number the appointment was booked with. A move is done on the call; a cancellation is confirmed by the clinic team."),
]


async def seed_clinic_data(db: AsyncSession) -> None:
    """Insert the clinic's doctors and knowledge base once (each only if its table is empty)."""
    if (await db.execute(select(Doctor.id).limit(1))).scalar_one_or_none() is None:
        for data in CLINIC_DOCTORS:
            db.add(Doctor(**data))
        logger.info("Seeded %d doctors", len(CLINIC_DOCTORS))
    if (await db.execute(select(ClinicKnowledge.id).limit(1))).scalar_one_or_none() is None:
        for order, (category, title, content) in enumerate(CLINIC_KNOWLEDGE):
            db.add(ClinicKnowledge(category=category, title=title, content=content, sort_order=order))
        logger.info("Seeded %d clinic knowledge entries", len(CLINIC_KNOWLEDGE))
    await db.commit()
