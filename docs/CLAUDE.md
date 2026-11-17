# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Zensark's Healthcare AI Calling Agent, configured for the **Six Sigma Clinic** pilot. One AI agent
(`CLINIC_AGENT_NAME`, "Maya") answers calls to the clinic in **English, Hindi or Telugu**, works out
what the caller needs, and records it. Workflows follow the clinic's workflow reference:

- **A. Appointment booking**: doctor/specialty, name + contact number, preferred time; the request is
  stored **pending** ("Pending confirmation"). The agent never says an appointment is booked unless a
  connected clinic system confirms it (none is connected: `APPOINTMENT_INTEGRATION=none`).
- **B. Doctor / specialty enquiry** and **C. clinic timings / services**: answered only from the
  Doctors table and the Clinic Knowledge base. The agent must not invent doctors, timings, fees or services.
- **D. Missed call / callback**: a staff follow-up. The agent never dials anyone.
- **E. Human assistance**: with `HUMAN_TRANSFER_NUMBER` set, the caller hears hold music (conference
  room) while the front desk rings for `HUMAN_TRANSFER_RING_SECONDS`; answered -> follow-up done,
  not answered -> busy message in the caller's language (Sarvam audio) and the follow-up stays open
  (`services/voice/telephony.py`, `routers/clinic_twilio.py` /hold, /busy-audio, /transfer-status).
  Without a number, a follow-up only.
- Questions the agent cannot answer from the prompt: `[[UNANSWERED_QUESTION ...]]` follow-up.
- Emergencies: advice to call 108 plus an urgent follow-up.

Everything staff must act on is ONE list, `follow_ups` (kinds emergency, distress, human_assistance,
unanswered_question, callback, confirm_appointment, staff; priority urgent/high/normal).

There are no outbound calls, chronic-care plans, check-ins or auto-callbacks (removed).

## Commands

No test suite or linter. Frontend type-checking is `npm run type-check`.

Backend (`backend/`, Python 3.11):
```powershell
python -m venv venv
.\venv\Scripts\pip.exe install -r requirements.txt
copy .env.example .env            # JWT_SECRET_KEY and DATABASE_URL are required
.\venv\Scripts\python.exe seed.py # creates tables, demo user, demo doctors + knowledge base
.\venv\Scripts\python.exe run.py  # uvicorn on :8000 with reload; Swagger at /docs
.\venv\Scripts\python.exe -m scripts.export_calls --days 7   # call records to CSV
```

Frontend (`frontend/`): `npm install`, `npm run dev` (:5173, proxies `/api` to :8000), `npm run build`, `npm run type-check`.

Demo login after seeding: `test@hospital.com` / `TestPass123!`.

## Data model

Tables are created by `Base.metadata.create_all` (startup and `seed.py`); there are no migrations, so
`DATABASE_URL` must point at a **new, empty database** for this schema. New models must be imported in
`models/__init__.py`. Clinic datetimes (`start_at`, `follow_up_at`) are naive clinic-local time;
`created_at` columns are UTC.

- `call_logs` + `call_turns`: one row per call. The "call record" columns (`patient_name`, `phone_number`,
  `language`, `intent`, `doctor_requested`, `preferred_slot`, `outcome`, `booking_status`, `next_action`)
  are filled after the call. Shown to staff as `SS-<1000+id>`.
- `appointments`: `pending | confirmed | cancelled | completed`. `pending`/`confirmed` with a `start_at`
  hold the doctor's slot. Staff confirm on the Appointments page (needs doctor + slot).
- `follow_ups` (`models/callback_schedule.py`): the one staff call-back list (see above);
  `confirm_appointment` ones close automatically when their appointment is confirmed/cancelled.
  `transfer_status` records the live-transfer result. (An `assistance_requests` table from an
  earlier version may exist in a database; it is no longer used.)
- `patients`: callers, created/linked by phone number after a call once a name is known.
- `doctors`, `clinic_knowledge`: clinic-specific configuration, edited in the UI; demo rows come from
  `app/knowledge/clinic_seed.py` (inserted into empty tables only).

## Live call pipeline

Phone: Twilio number webhook `POST {API_BASE_URL}/twilio/clinic/inbound` → creates the `CallLog` and opens a
Media Stream to `/twilio/stream/{sid}`. Browser: "Call the Agent" page, either Twilio Voice SDK (same webhook,
`routers/browser_call.py`) or the direct websocket `routers/sim_call.py` (no Twilio). All land in
`services/agent/call_agent.py::run_call_stream`.

`CallAgentSession` (subclass of `services/voice/twilio_service.py::CallSession`): μ-law audio → Deepgram STT
(`services/voice/stt_service.py`) → Claude streaming (`claude_service.py`) sentence by sentence → Sarvam TTS,
with barge-in. The greeting is spoken in three parts (English, Hindi, Telugu voices). Until the caller picks a
language, STT uses Deepgram's multilingual Hindi+English model; `[[SET_LANGUAGE:xx]]` switches the voice
(`selected_digit`) and reconnects STT for that language (`LANGUAGE_DIGITS` in `context_shared.py`:
te=1, hi=2, en=3).

After hangup `call_finalizer.finalize_call` makes one Claude (Haiku) call (`CALL_SUMMARY_PROMPT`) for the
call record, upserts the patient, and adds safety-net rows (appointment request / follow-up / assistance) if
the agent missed writing a token.

### Prompts and tokens
- `prompts/inbound_prompts.py`: opening lines + receptionist prompt (workflows A to E, doctor list with free
  slots, knowledge base), filled by `services/agent/inbound_context.py`.
- `prompts/common_prompts.py`: shared rules (no invented facts, emergencies, language, style) + summary prompt.

Tokens (stripped from audio, acted on in `call_agent.py`): `[[SET_LANGUAGE:en|hi|te]]`,
`[[APPOINTMENT_REQUEST name=..; phone=..|caller; doctor_id=..; doctor=..; preferred=..; slot=..; reason=..]]`
(`appointment_service.record_appointment_request`; repeating it in the same call updates the request),
`[[CALLBACK_REQUEST ...]]`, `[[UNANSWERED_QUESTION question=..]]`, `[[HUMAN_ASSISTANCE reason=..]]`, `[[ESCALATE:emergency|distress]]`, `[[END_CALL]]`.

### Appointment integration
`services/scheduling/appointment_service.py` has an `AppointmentProvider` interface. Add a provider for a
clinic MIS/CRM/appointment API whose `book()` returns `confirmed=True` only after a successful booking; with
none, every request is pending and a `confirm_appointment` follow-up is created.

## Auth
JWT bearer on all `/api/*` routes except login/register/refresh. Twilio webhooks use signature validation.

## Not updated
`render.yaml`, `deploy/` and `docs/DEPLOYMENT.md` still describe the earlier chronic-care deployment.
