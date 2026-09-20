import asyncio
import sys
from datetime import datetime, timedelta
from sqlalchemy import select

from app.database import AsyncSessionLocal, init_db
from app.models.care_team_user import CareTeamUser
from app.models.condition import ChronicCondition
from app.models.disease_protocol import DiseaseProtocol
from app.models.patient import Patient
from app.models.condition import PatientCondition
from app.models.care_plan import CarePlan
from app.knowledge.seed_protocols import (
    DIABETES_PROTOCOL,
    HYPERTENSION_PROTOCOL,
    COPD_PROTOCOL,
    ASTHMA_PROTOCOL,
)
from app.security import hash_password


async def seed_database():
    # Initialize database schema
    await init_db()
    print("✓ Database schema initialized")

    async with AsyncSessionLocal() as db:
        # Check if data already seeded
        result = await db.execute(select(ChronicCondition).limit(1))
        if result.scalar_one_or_none():
            print("✓ Database already seeded, skipping...")
            return

        # Seed demo care team user
        demo_user = CareTeamUser(
            name="Demo Care Manager",
            email="test@hospital.com",
            hashed_password=hash_password("TestPass123!"),
            role="care_manager",
            is_active=True,
        )
        db.add(demo_user)
        await db.flush()
        print("✓ Added demo care team user: test@hospital.com")

        # Seed chronic conditions
        conditions_data = [
            ("T2DM", "Type 2 Diabetes Mellitus"),
            ("HTN", "Hypertension"),
            ("COPD", "Chronic Obstructive Pulmonary Disease"),
            ("ASTHMA", "Asthma"),
        ]

        conditions = {}
        for code, name in conditions_data:
            condition = ChronicCondition(code=code, display_name=name)
            db.add(condition)
            await db.flush()
            conditions[code] = condition
            print(f"✓ Added condition: {name}")

        # Seed disease protocols
        protocols_map = {
            "T2DM": DIABETES_PROTOCOL,
            "HTN": HYPERTENSION_PROTOCOL,
            "COPD": COPD_PROTOCOL,
            "ASTHMA": ASTHMA_PROTOCOL,
        }

        for code, protocol_data in protocols_map.items():
            protocol = DiseaseProtocol(
                condition_id=conditions[code].id,
                **protocol_data,
            )
            db.add(protocol)
            print(f"✓ Added protocol for {code}")

        # Seed demo patients
        demo_patients = [
            {
                "mrn": "PT001",
                "first_name": "John",
                "last_name": "Smith",
                "phone_number": "+1234567890",
                "preferred_language": "en",
                "status": "active",
                "enrolled_at": datetime.utcnow(),
            },
            {
                "mrn": "PT002",
                "first_name": "Maria",
                "last_name": "Garcia",
                "phone_number": "+1987654321",
                "preferred_language": "es",
                "status": "active",
                "enrolled_at": datetime.utcnow(),
            },
            {
                "mrn": "PT003",
                "first_name": "Robert",
                "last_name": "Chen",
                "phone_number": "+1555123456",
                "preferred_language": "en",
                "status": "active",
                "enrolled_at": datetime.utcnow(),
            },
            {
                "mrn": "PT004",
                "first_name": "Patricia",
                "last_name": "Williams",
                "phone_number": "+1555987654",
                "preferred_language": "en",
                "status": "active",
                "enrolled_at": datetime.utcnow(),
            },
            {
                "mrn": "PT005",
                "first_name": "James",
                "last_name": "Brown",
                "phone_number": "+1555456789",
                "preferred_language": "en",
                "status": "active",
                "enrolled_at": datetime.utcnow(),
            },
        ]

        patients = []
        for patient_data in demo_patients:
            patient = Patient(**patient_data)
            db.add(patient)
            await db.flush()
            patients.append(patient)
            print(f"✓ Added patient: {patient.first_name} {patient.last_name}")

        # Link patients to conditions and create care plans
        patient_condition_map = [
            (patients[0].id, conditions["T2DM"].id),    # John - Diabetes
            (patients[1].id, conditions["HTN"].id),     # Maria - Hypertension
            (patients[2].id, conditions["COPD"].id),    # Robert - COPD
            (patients[3].id, conditions["ASTHMA"].id),  # Patricia - Asthma
            (patients[4].id, conditions["T2DM"].id),    # James - Diabetes
        ]

        for patient_id, condition_id in patient_condition_map:
            pc = PatientCondition(
                patient_id=patient_id,
                condition_id=condition_id,
                diagnosed_date=datetime.now().date(),
                severity="moderate",
                is_primary=True,
                status="active",
            )
            db.add(pc)
            await db.flush()

            # Get protocol for this condition
            proto_result = await db.execute(
                select(DiseaseProtocol)
                .where(DiseaseProtocol.condition_id == condition_id)
                .where(DiseaseProtocol.is_active == True)
            )
            protocol = proto_result.scalar_one()

            # Create care plan
            care_plan = CarePlan(
                patient_id=patient_id,
                patient_condition_id=pc.id,
                protocol_id=protocol.id,
                followup_interval_days=protocol.default_followup_interval_days,
                next_due_date=datetime.utcnow() + timedelta(days=7),
                status="active",
                assigned_physician_name="Dr. Sample",
            )
            db.add(care_plan)
            print(f"✓ Created care plan for patient {patient_id}")

        await db.commit()
        print("\n✓ Database seeding complete!")


if __name__ == "__main__":
    try:
        asyncio.run(seed_database())
    except Exception as e:
        print(f"✗ Seeding failed: {e}", file=sys.stderr)
        sys.exit(1)
