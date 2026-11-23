# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Zensark's Healthcare AI Calling Agent, configured for the **Six Sigma Clinic** pilot. One inbound voice
agent (`CLINIC_AGENT_NAME`, "Maya") answers calls in **English, Hindi or Telugu**, records what the caller
needs, and a React staff console lets clinic staff act on it. Backend: FastAPI + async SQLAlchemy.
Frontend: React 19 + Vite + TanStack Router + React Query + Zustand + Tailwind.

The agent never confirms a booking itself: every appointment it records is `pending` until staff confirm
it (`APPOINTMENT_INTEGRATION=none`). It never dials out. There are no outbound calls, chronic-care plans or
auto-callbacks (removed from an earlier version; `render.yaml`, `docs/DEPLOYMENT.md` still describe that
version and should not be trusted).

## Commands

No test suite or linter exists. Verify backend edits with `python -m py_compile <files>`; frontend with
`npm run type-check`.

Backend (`backend/`, Python 3.11, Windows venv paths):
```powershell
python -m venv venv
.\venv\Scripts\pip.exe install -r requirements.txt
copy .env.example .env             # JWT_SECRET_KEY and DATABASE_URL are required
.\venv\Scripts\python.exe seed.py  # tables + demo user admin@hospital.com / Admin123! + demo doctors/knowledge
.\venv\Scripts\python.exe run.py   # uvicorn :8000 with reload; Swagger at /docs
.\venv\Scripts\python.exe create_user.py --email x@clinic.com --password "..." --name "..."
.\venv\Scripts\python.exe reset_clinic_data.py [--yes]   # wipes all data except users; dry run without --yes
.\venv\Scripts\python.exe -m scripts.export_calls --days 7
```

Frontend (`frontend/`): `npm install`, `npm run dev` (:5173, proxies `/api` incl. websockets to :8000),
`npm run build`, `npm run type-check`.

Everything at once for real phone calls: `powershell -ExecutionPolicy Bypass -File .\start-all.ps1` —
starts a Cloudflare quick tunnel, **rewrites `API_BASE_URL` in `backend/.env`** with the tunnel URL,
restarts the backend, starts Vite.

Deploy (dev server `callingapp-dev.zensark.com`): `bash deploy/deploy.sh` on the server. Backend runs in
Docker container `patientpulse-api` on 127.0.0.1:8010 with `ROOT_PATH=/patientpulse-api`; nginx
(`deploy/patientpulse-nginx.conf`) serves the frontend at `/patientpulse/` and proxies
`/patientpulse-api/`. Note: `deploy.sh` overrides `DATABASE_URL` with SQLite, ignoring the Postgres URL
in `.env`. Frontend production paths come from `frontend/.env.production` (`VITE_BASE_PATH`, `VITE_API_BASE`).

## Database

- `DATABASE_URL` (async: `postgresql+asyncpg://...?ssl=require` or `sqlite+aiosqlite://...`) and
  `DATABASE_SCHEMA` (e.g. `six-sigma`; must already exist; applied via `search_path`).
- No migrations. `init_db()` runs `create_all` plus `_NEW_COLUMNS` in `app/database.py` (the only way
  columns get added to existing tables). A new nullable column on an existing table must be added there;
  anything else needs a fresh schema. New models must be imported in `app/models/__init__.py`.
- `start_at`, `follow_up_at` are naive **clinic-local** time (`CLINIC_UTC_OFFSET_MINUTES`, IST);
  every `created_at` is UTC. Use `clinic_now()` from `services/scheduling/clinic_scheduling.py`.
- Calls are shown to staff as `SS-<1000+id>` (`call_ref`).

Key tables: `call_logs` + `call_turns` (call record columns filled after hang-up), `appointments`
(`pending | confirmed | cancel_requested | cancelled | completed`; `pending/confirmed/cancel_requested` are
"active"), `follow_ups` (`models/callback_schedule.py`, the single staff to-do list), `patients` (unique
by phone), `doctors`, `clinic_knowledge`, `notification_reads/clears`.

There are **no appointment slots**: doctors have `working_days` (0=Mon) and `start_time`/`end_time`;
a visit is valid if inside them (`visit_problem` / `check_visit`). `slot_minutes` and `end_at` are unused.

## Live call pipeline

All three entry points end in `services/agent/call_agent.py::run_call_stream`, which speaks Twilio's
Media Streams protocol:
- Phone: Twilio number webhook `POST {API_BASE_URL}/twilio/clinic/inbound` creates the `CallLog`, returns
  TwiML opening `wss://.../twilio/stream/{CallSid}` (`routers/clinic_twilio.py`, `twilio_webhook.py`).
- Browser direct test (the only mode the UI uses): websocket `/api/sim-call/stream`
  (`routers/sim_call.py`, `frontend/src/lib/directCall.ts` does 8 kHz μ-law in the browser). JWT in the first
  message; call_sid prefixed `SIM`. No transfer or recording.
- Browser via Twilio Voice SDK: backend support exists (`routers/browser_call.py` token), UI doesn't use it.

Twilio signs requests against the **public** URL, so webhook validation and stream URLs are built from
`API_BASE_URL` (`services/public_url.py`), not the incoming request. Wrong `API_BASE_URL` = every webhook 403s.

`CallAgentSession` (subclass of `services/voice/twilio_service.py::CallSession`): μ-law → Deepgram STT
(`stt_service.py`) → Claude streaming (`claude_service.py`, `LIVE_MODEL`) sentence by sentence → Sarvam TTS
(`sarvam_tts_service.py`), with barge-in, silence re-prompt/hang-up and max call length watchdog.
`[[SET_LANGUAGE:xx]]` switches voice and reconnects STT (`LANGUAGE_DIGITS` in `context_shared.py`:
te=1, hi=2, en=3; before a choice STT uses the multilingual model).

Context per call (`services/agent/inbound_context.py`): receptionist prompt with doctors, knowledge base,
14-day calendar, and — matched on the caller's **last 10 digits** — the last 3 call summaries (60 days),
open follow-ups and upcoming appointments. A saved patient is greeted by name in their saved language.

### Tokens
The agent writes control tokens in its reply; they are stripped from audio and handled in
`CallAgentSession._handle_token`, gated by capabilities (`call_context.py`). After acting, a
`[[..._RECORDED ...]]`-style system note is fed back so the agent reports the real outcome.
- `[[APPOINTMENT_REQUEST name=..; phone=..|caller; doctor_id=..; doctor=..; preferred=..; visit=YYYY-MM-DDTHH:MM; reason=..]]`
  → pending appointment + `confirm_appointment` follow-up (repeat in same call updates it)
- `[[APPOINTMENT_RESCHEDULE id=..; visit=..; preferred=..]]` → moves it now, `change_note`, `rescheduled` follow-up
- `[[APPOINTMENT_CANCEL id=..; reason=..]]` → `cancel_requested` + high-priority `cancel_request` follow-up
- `[[CALLBACK_REQUEST ...]]`, `[[UNANSWERED_QUESTION question=..]]`, `[[HUMAN_ASSISTANCE reason=..]]`,
  `[[ESCALATE:emergency|distress]]`, `[[END_CALL]]`

Reschedule/cancel only work on appointments whose phone matches the caller's number (privacy rule in
`_callers_appointment`). Prompts live in `prompts/inbound_prompts.py` (workflows A–E, token examples) and
`prompts/common_prompts.py` (shared rules, `CALL_SUMMARY_PROMPT`).

Human transfer (`services/voice/telephony.py`): with `HUMAN_TRANSFER_NUMBER` set, the caller goes into a
Twilio conference with hold music while the front desk rings; `/twilio/clinic/transfer-status` marks the
follow-up answered (done) or not answered (busy message via `/busy-audio`, follow-up stays open).

After hang-up, `call_finalizer.finalize_call` makes one Claude Haiku call for the call record, upserts
the patient by phone, and adds safety-net rows (appointment / callback / emergency / human / unanswered)
the agent forgot to token. Stale `in-progress` calls are closed on startup (`call_cleanup.py`).

## Staff-side rules worth knowing

- `PATCH /api/appointments/{id}` to `confirmed`/`cancelled` closes that appointment's
  `confirm_appointment`/`cancel_request`/`rescheduled` follow-ups and re-syncs the call's `booking_status`.
  Closing a follow-up does **not** change its appointment.
- Notifications are not stored; `routers/notifications.py` builds them live from open follow-ups and
  pending appointments. Only per-user read/clear keys are persisted.
- `normalize_phone` (`routers/clinic.py`) is shared: E.164, bare 10 digits get +91.
- Auth: JWT bearer on `/api/*` except login/refresh/register; frontend stores tokens in localStorage and
  refreshes on 401 (`frontend/src/lib/apiClient.ts`). `require_role` exists but is not applied anywhere.

## Frontend

All API calls go through `src/lib/apiClient.ts` (base `VITE_API_BASE`, default `/api`); data hooks in
`src/hooks/` own polling intervals and cache invalidation after mutations. Routes in `src/router.tsx`;
auth redirect and sidebar/shortcuts in `src/pages/RootLayout.tsx`. `/knowledge` is reachable only from
the command palette.
