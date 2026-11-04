# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

There is no test suite or linter configured. `test_call.py` (repo root) is a manual script that simulates Twilio WebSocket events against the local DB; it is not pytest. Frontend type-checking is `npm run type-check`.

Backend (`backend/`, Python 3.11, Windows venv):
```powershell
python -m venv venv
.\venv\Scripts\pip.exe install -r requirements.txt
copy .env.example .env            # JWT_SECRET_KEY is the only required setting
.\venv\Scripts\python.exe seed.py # creates tables + demo user, conditions, protocols, patients
.\venv\Scripts\python.exe run.py  # uvicorn on :8000 with reload; Swagger at /docs
```

Frontend (`frontend/`): `npm install`, `npm run dev` (:5173, proxies `/api` to :8000), `npm run build`, `npm run type-check`.

Everything incl. Cloudflare tunnel: `powershell -ExecutionPolicy Bypass -File .\start-all.ps1` (see `SETUP_GUIDE.txt`; `DEPLOYMENT*.md` + `deploy/` cover the dev server).

Demo login after seeding: `test@hospital.com` / `TestPass123!`. To reset the DB, delete `backend/patient_engagement.db` and re-run `seed.py`.

## Architecture

FastAPI (async SQLAlchemy 2, SQLite via aiosqlite) backend + React/TS/Vite/Tailwind frontend (TanStack Router/Query, zustand, axios). 
**One AI phone agent** (`settings.clinic_agent_name`, "Maya") handles every call. The call's `direction` and the caller decide the context it is given:

- **outbound** — chronic-care health check-in for an enrolled patient (diabetes/HTN/COPD/asthma), built from their disease protocol.
- **inbound** — patients call the clinic number; the agent answers as receptionist, picks a doctor and books a slot mid-call.
- **inbound from an enrolled patient** (last 10 digits of the number match a `patients` row) — receptionist that also knows the care plan and its red flags (`call_logs.plan_id` is set).

One set of tables serves all of it:
- `call_logs` + `call_turns` (`models/call_log.py`) — every call, told apart by `direction` (inbound/outbound). `patient_id` is nullable (unknown inbound callers); care-plan and extracted-summary columns are nullable.
- `appointments` (`models/appointment.py`) — `source` agent/staff. Booked-in-call and staff bookings start `booked`; a visit requested after a check-in starts `requested` and staff confirm. `doctor_id` links to `doctors`; `start_at` is null for a request with no time yet. Slots are held by statuses in `ACTIVE_STATUSES`, so nothing can double-book a doctor.
- `doctors` (`models/doctor.py`) — schedules used for in-call booking and for chronic-care availability/booking (matched to `plans.assigned_physician_name` by name).
- `escalations` — `call_log_id` points at any call; `patient_id` nullable. Raised live by `[[ESCALATE]]`, or after the call for red flags / `urgent`/`emergency` callers (at most one per call from the finalizer).

API: `/api/calls` is the single call API (`routers/calls.py`): `GET /` and `GET /stats` take `?direction=inbound|outbound`, `POST /` dials a patient (outbound), `GET /{id}` returns the call with its turns. `/api/appointments` is likewise the only appointments API (`GET /` filters by `patient_id`, `doctor_id`, `status`, `source`, dates; `POST /book` is a staff booking into a doctor's slot). `/api/clinic` only has `info`, `stats` and `doctors`.

UI: sidebar is Dashboard, Patients, Doctors, Call Logs, Appointments, Escalations; Call Logs and Appointments are single pages with direction/status/source filters.

### Live call pipeline
Outbound: staff click in UI → router creates a `CallLog` row (direction=outbound) and uses the Twilio REST API → Twilio POSTs `/twilio/twiml`, signature-validated → TwiML opens a Media Stream WebSocket.
Inbound: the Twilio number's Voice webhook is set to `{API_BASE_URL}/twilio/clinic/inbound` (POST) → the route creates the `CallLog` (direction=inbound) and opens the same WebSocket. Optionally set the number's "Call status changes" URL to `/twilio/clinic/status` (outbound uses `/twilio/status`; both share `apply_call_status`).

Both directions land on **one** WebSocket, `/twilio/stream/{sid}` → `services/call_agent.py::run_call_stream`, which loads the `Call`, asks `services/call_context.py::build_call_context` for the prompt, greeting and capabilities, and runs `CallAgentSession` (subclass of `services/twilio_service.py::CallSession`): μ-law audio → Deepgram STT (`stt_service.py`; class is misleadingly named `SarvamStream`) → Claude streaming (`claude_service.py`) sentence-by-sentence → Sarvam TTS → frames back to Twilio, with barge-in cancellation. After hangup, `call_finalizer.py::finalize_call` makes one Claude (Haiku) call with a single summary schema (`claude_service.finalize_call_summary`) for every call, which drives escalations, appointment requests and (outbound only) care-plan rescheduling.

Twilio must reach the backend, so `API_BASE_URL` must be a public https URL (Cloudflare tunnel; `start-all.ps1` rewrites it in `.env`). `services/public_url.py` rebuilds the public URL for signature validation behind a proxy. `ROOT_PATH` / `VITE_BASE_PATH` / `VITE_API_BASE` handle the `/patientpulse` prefix on the dev server (`frontend/.env.production`); locally they are empty.

### Prompts, capabilities and control tokens
Claude is steered by in-band `[[TOKENS]]` that `CallAgentSession` strips from audio and acts on, but only if the call's context grants the capability (`CAP_*` in `call_context.py`); other tokens are stripped and ignored.
- Outbound context (`prompt_builder.py::build_system_prompt`, one f-string template filled from a `DiseaseProtocol` DB row): `escalate` + `appointment_request`. Clinical content originates in `app/knowledge/seed_protocols.py` (Python dicts), is copied to the DB by `seed.py` only once (it skips if any condition exists, so editing the dicts later does nothing for an existing DB).
- Inbound context (`call_context.py::build_receptionist_prompt`, hardcoded template plus doctors/free slots queried live per call, plus a CARE PLAN block for enrolled patients): `book`, and `escalate` when a care plan is attached.
- Tokens: `[[BOOK_APPOINTMENT doctor_id=..; start=..; name=..; reason=..]]` (books via `clinic_scheduling.book_slot`), `[[ESCALATE:id]]` (creates an escalation immediately), `[[APPOINTMENT_REQUESTED]]`, `[[END_CALL]]` (handled by `CallSession`), `[[SWITCH_LANGUAGE_XX]]` (stripped and logged only; language switching is not wired up).

### Data: static vs runtime
Static/seeded: disease protocols and conditions (`seed.py`), the 6 `DEMO_DOCTORS` (`clinic_scheduling.py`, auto-seeded in the FastAPI lifespan if the table is empty). Chronic-care availability uses the real doctor schedule when the care plan's physician matches a doctor by name (seed uses "Dr. Ananya Rao"), otherwise mock slots in `appointment_service.py`. Everything else is runtime data. Tables are created by `Base.metadata.create_all` at startup; there are no migrations, so schema changes to an existing SQLite DB require manual handling or a reset. New models must be imported in `models/__init__.py`.

Clinic datetimes are naive and in local clinic time (`CLINIC_UTC_OFFSET_MINUTES`); `created_at` columns are UTC.

### Auth
JWT bearer (`security.py`, `deps.py::get_current_user`) on all `/api/*` routes except login/register. Twilio webhook routes use Twilio signature validation instead. `/api/debug/*` routes in `main.py` are unauthenticated.

## Known issues (verified by reading, not by running)
- `scheduler_service.run_outreach_scheduler` is never started (commented out in `main.py`); calls only happen via the UI.
