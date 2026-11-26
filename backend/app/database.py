import logging

from sqlalchemy import String, event, inspect, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Session

from app.config import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()
logger = logging.getLogger(__name__)


@event.listens_for(Session, "before_flush")
def _fit_text_to_columns(session, flush_context, instances) -> None:
    """Shorten any text longer than its column (e.g. a long AI-written "preferred slot") instead of failing.

    Without this one over-long value made PostgreSQL reject the whole save at the end of a call, and the
    call stayed "live" with no summary or recording link.
    """
    for obj in list(session.new) + list(session.dirty):
        try:
            mapper = inspect(obj).mapper
        except Exception:
            continue
        for attr in mapper.column_attrs:
            column = attr.columns[0]
            length = getattr(column.type, "length", None)
            if not isinstance(column.type, String) or not length:
                continue
            value = getattr(obj, attr.key, None)
            if isinstance(value, str) and len(value) > length:
                setattr(obj, attr.key, value[: length - 1] + "…")
                logger.warning(f"{mapper.class_.__name__}.{attr.key} was {len(value)} characters; shortened to {length}")


def _connect_args() -> dict:
    """PostgreSQL: work only inside DATABASE_SCHEMA (search_path), so all tables live in that schema."""
    schema = settings.database_schema.strip().strip('"')
    if not schema or not settings.database_url.startswith("postgresql"):
        return {}
    # Quoted, so names like "six-sigma" (with a dash) work
    return {"server_settings": {"search_path": f'"{schema}"'}}


engine = create_async_engine(
    settings.database_url,
    echo=False,
    future=True,
    pool_pre_ping=True,
    connect_args=_connect_args(),
)

AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


# Nullable columns added after a table was first created: create_all never alters an existing
# table, so these are added here when missing (keeps an existing test database working).
_NEW_COLUMNS = {
    "appointments": {
        "change_note": "VARCHAR(300)",
    },
    "follow_ups": {
        "priority": "VARCHAR(10) DEFAULT 'normal'",
        "transfer_status": "VARCHAR(20)",
    },
}


def _add_new_columns(sync_conn) -> None:
    inspector = inspect(sync_conn)
    tables = inspector.get_table_names()
    for table, columns in _NEW_COLUMNS.items():
        if table not in tables:
            continue
        existing = {c["name"] for c in inspector.get_columns(table)}
        for name, ddl in columns.items():
            if name not in existing:
                sync_conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))


async def init_db():
    """Create any missing tables (and the few columns in _NEW_COLUMNS). There are no migrations
    beyond that: a different schema needs a new, empty database."""
    import app.models  # noqa: F401  (registers every model on Base.metadata)

    async with engine.begin() as conn:
        schema = settings.database_schema.strip().strip('"')
        if schema and settings.database_url.startswith("postgresql"):
            found = (await conn.execute(
                text("SELECT 1 FROM information_schema.schemata WHERE schema_name = :s"), {"s": schema}
            )).scalar()
            if not found:
                raise RuntimeError(f'Database schema "{schema}" does not exist. Create it first, or fix DATABASE_SCHEMA in .env.')
        await conn.run_sync(_add_new_columns)
        await conn.run_sync(Base.metadata.create_all)


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
