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

Both directions land on **one** WebSocket, `/twilio/stream/{sid}` → `services/agent/call_agent.py::run_call_stream`, which loads the `Call`, asks `services/agent/call_context.py::build_call_context` for the prompt, greeting and capabilities, and runs `CallAgentSession` (subclass of `services/voice/twilio_service.py::CallSession`): μ-law audio → Deepgram STT (`services/voice/stt_service.py`; class is misleadingly named `SarvamStream`) → Claude streaming (`services/agent/claude_service.py`) sentence-by-sentence → Sarvam TTS → frames back to Twilio, with barge-in cancellation. After hangup, `services/agent/call_finalizer.py::finalize_call` makes one Claude (Haiku) call with a single summary schema (`claude_service.finalize_call_summary`) for every call, which drives escalations, appointment requests and (outbound only) care-plan rescheduling.

Twilio must reach the backend, so `API_BASE_URL` must be a public https URL (Cloudflare tunnel; `start-all.ps1` rewrites it in `.env`). `services/public_url.py` rebuilds the public URL for signature validation behind a proxy. `ROOT_PATH` / `VITE_BASE_PATH` / `VITE_API_BASE` handle the `/patientpulse` prefix on the dev server (`frontend/.env.production`); locally they are empty.

### Prompts, capabilities and control tokens
Claude is steered by in-band `[[TOKENS]]` that `CallAgentSession` strips from audio and acts on, but only if the call's context grants the capability (`CAP_*` in `services/agent/context_shared.py`); other tokens are stripped and ignored.

Prompt text is split by direction, and the context builders are split the same way:
- `prompts/common_prompts.py`: rules every call gets (identity, emergencies, medicines, distress, style, ending), clinic facts, callback rules, callback openings, previous-conversation block, after-call summary prompt.
- `prompts/outbound_prompts.py` + `services/agent/outbound_context.py` (+ `prompts/chronic_prompt.py`, which fills the check-in prompt from a `DiseaseProtocol` row): health check-ins, the no-care-plan fallback, and callbacks after a check-in. Capabilities: `escalate`, `appointment_request`, `callback`.
- `prompts/inbound_prompts.py` + `services/agent/inbound_context.py`: the receptionist for calls to the clinic number (doctors/free slots queried live, CARE PLAN block only after the caller confirms who they are), and callbacks to people who phoned in. Capabilities: `book`, `escalate`, `callback`.
- `services/agent/call_context.py::build_call_context` only decides which of these a call uses.

Every call Maya places opens with "Am I speaking with <full name>?" and shares nothing before a clear yes; the recording notice is spoken only when the call is recorded (`CALL_RECORDING_ENABLED`, or the browser page's tick box). Clinical content originates in `app/knowledge/seed_protocols.py`; `seed.py` copies it once. The app never changes an existing database's protocols by itself: `python scripts/sync_protocols.py` shows which new red flags (by id) are missing, and `--apply` writes them (take a backup first; the dev/prod database is RDS). Per-call recording choice for inbound calls is kept in memory (`context_shared.set_inbound_recording`), so no schema change is needed.

Tokens: `[[BOOK_APPOINTMENT doctor_id=..; start=..; name=..; reason=..]]` (books via `clinic_scheduling.book_slot`), `[[ESCALATE:id]]` (creates an escalation immediately, severity from the protocol's red flag), `[[APPOINTMENT_REQUESTED]]`, `[[SCHEDULE_CALLBACK when=..; reason=..]]` (rejected with `[[CALLBACK_FAILED ...]]` if the time is invalid or outside calling hours), `[[END_CALL]]` (handled by `CallSession`).

Browser calling: the "Call the Agent" page (`frontend/src/pages/CallAgentPage.tsx`, Twilio Voice SDK) gets a token from `routers/browser_call.py` and dials a TwiML App whose Voice URL is `/twilio/clinic/inbound`, so it takes the same path as a real call to the clinic number.

### Data: static vs runtime
Static/seeded: disease protocols and conditions (`seed.py`), the 6 `DEMO_DOCTORS` (`services/scheduling/clinic_scheduling.py`, auto-seeded in the FastAPI lifespan if the table is empty). Chronic-care availability uses the real doctor schedule when the care plan's physician matches a doctor by name (seed uses "Dr. Ananya Rao"), otherwise mock slots in `appointment_service.py`. Everything else is runtime data. Tables are created by `Base.metadata.create_all` at startup; there are no migrations, so schema changes to an existing SQLite DB require manual handling or a reset. New models must be imported in `models/__init__.py`.

Clinic datetimes are naive and in local clinic time (`CLINIC_UTC_OFFSET_MINUTES`); `created_at` columns are UTC.

### Auth
JWT bearer (`auth/security.py`, `auth/deps.py::get_current_user`) on all `/api/*` routes except login/register. Twilio webhook routes use Twilio signature validation instead. `/api/debug/*` routes in `main.py` are unauthenticated.

## Known issues (verified by reading, not by running)
- `scheduler_service.run_outreach_scheduler` is never started (commented out in `main.py`); calls only happen via the UI.
