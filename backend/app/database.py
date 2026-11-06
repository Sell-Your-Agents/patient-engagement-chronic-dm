import logging

from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.config import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()
engine = create_async_engine(
    settings.database_url,
    echo=False,
    future=True,
)

AsyncSessionLocal = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)


# Columns added to callback_schedules after it was first created (all nullable)
_CALLBACK_SCHEDULE_NEW_COLUMNS = {
    "phone_number": "VARCHAR(20)",
    "patient_name": "VARCHAR(120)",
    "call_log_id": "INTEGER REFERENCES call_logs(id)",
}


def _upgrade_callback_schedules(sync_conn) -> None:
    """create_all never alters tables: bring an older callback_schedules table up to date.

    The first version required a patient and care plan and had no phone/name columns. It is
    dropped and recreated when empty; otherwise the not-null rules are relaxed (PostgreSQL) and
    any missing columns are added.
    """
    inspector = inspect(sync_conn)
    tables = inspector.get_table_names()
    if "callback_schedules" not in tables:
        return
    columns = {c["name"]: c for c in inspector.get_columns("callback_schedules")}
    if "schedule_type" not in columns:
        # A table from an unrelated earlier design: set it aside (rows kept) and start fresh.
        # Its indexes are dropped first; index names are database-wide and would clash.
        legacy = "callback_schedules_legacy"
        while legacy in tables:
            legacy += "_old"
        for index in inspector.get_indexes("callback_schedules"):
            if index.get("name"):
                sync_conn.execute(text(f'DROP INDEX "{index["name"]}"'))
        sync_conn.execute(text(f"ALTER TABLE callback_schedules RENAME TO {legacy}"))
        logging.getLogger(__name__).warning(f"callback_schedules had an unknown layout; renamed it to {legacy}")
        return
    if all(name in columns for name in _CALLBACK_SCHEDULE_NEW_COLUMNS):
        return
    if "phone_number" not in columns and sync_conn.execute(text("SELECT COUNT(*) FROM callback_schedules")).scalar() == 0:
        sync_conn.execute(text("DROP TABLE callback_schedules"))
        return
    if sync_conn.dialect.name == "postgresql" and not columns["patient_id"]["nullable"]:
        sync_conn.execute(text(
            "ALTER TABLE callback_schedules ALTER COLUMN patient_id DROP NOT NULL, ALTER COLUMN plan_id DROP NOT NULL"
        ))
    for name, ddl in _CALLBACK_SCHEDULE_NEW_COLUMNS.items():
        if name not in columns:
            sync_conn.execute(text(f"ALTER TABLE callback_schedules ADD COLUMN {name} {ddl}"))


# Nullable columns added to existing tables after they were first created
_NEW_COLUMNS = {
    "disease_protocols": {
        "default_call_time": "VARCHAR(5)",
        "default_followup_interval_minutes": "INTEGER",
    },
    "plans": {"followup_interval_minutes": "INTEGER"},
}


def _add_new_columns(sync_conn) -> None:
    """create_all never alters tables: add the columns in _NEW_COLUMNS that a table is missing."""
    inspector = inspect(sync_conn)
    tables = inspector.get_table_names()
    for table, new_columns in _NEW_COLUMNS.items():
        if table not in tables:
            continue
        existing = {c["name"] for c in inspector.get_columns(table)}
        for name, ddl in new_columns.items():
            if name not in existing:
                sync_conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(_upgrade_callback_schedules)
        await conn.run_sync(_add_new_columns)
        await conn.run_sync(Base.metadata.create_all)


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
