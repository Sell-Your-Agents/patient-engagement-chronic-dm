# Patient Engagement System — Complete Deployment Guide

Full-stack patient engagement platform with agentic AI voice calls, scheduling, and care team dashboard.

## 🚀 Quick Start

### Backend
```bash
cd backend
python -m venv venv
source venv/Scripts/activate  # Windows
pip install -r requirements.txt
python seed.py  # Initialize demo data
python run.py   # Start API at http://localhost:8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev  # Start at http://localhost:5173
```

Visit **http://localhost:5173** and login with:
- Email: `test@hospital.com`
- Password: `TestPass123!`

---

## 📋 What's Included

### Backend (FastAPI)

**Phase 1: Foundations**
- SQLAlchemy ORM with SQLite
- JWT authentication + role-based access control
- 10 domain models (patients, conditions, protocols, calls, escalations, etc.)
- CRUD routers for core resources

**Phase 2: Voice + Claude**
- Twilio media-stream voice integration
- Real-time Claude conversation streaming
- Deepgram speech-to-text, Sarvam AI text-to-speech
- Post-call structured summary extraction via Haiku
- Transcript persistence

**Phase 3: Scheduler + Escalations**
- Background scheduler (auto-dials patients due for outreach)
- Escalation case management (red-flag detection)
- Appointment scheduling with mock availability
- Medication reminder tracking
- KPI analytics with trends

### Frontend (React 19 + TanStack)

**Navigation**
- Login page (JWT auth)
- Dashboard (real-time KPIs)
- Patient list with quick-dial action
- Escalation queue (urgent cases, reassignment)
- Call log with transcript viewer
- Appointment management
- Side navigation

**Features**
- React Query for server state + auto-refetch
- Zustand for auth state
- TanStack Router for file-based routing
- Tailwind CSS responsive design
- TypeScript for type safety

---

## 📊 Key Endpoints

### Auth
- `POST /api/auth/register` — Create care team user
- `POST /api/auth/login` — Get JWT token
- `GET /api/auth/me` — Current user

### Patients
- `GET /api/patients/` — List patients
- `POST /api/patients/` — Create patient
- `GET /api/patients/{id}` — Patient detail

### Calls
- `GET /api/outreach-calls/` — Call history
- `POST /api/outreach-calls/initiate` — Dial patient
- `GET /api/outreach-calls/stats/summary` — Call metrics

### Escalations
- `GET /api/escalations/` — Open cases
- `PATCH /api/escalations/{id}` — Assign/resolve
- `GET /api/escalations/stats/summary` — Escalation metrics

### Analytics
- `GET /api/analytics/kpis` — Dashboard metrics
- `GET /api/analytics/kpis/trend` — 30-day trends

---

## 🛠 Architecture

### Backend Stack
- FastAPI (async web framework)
- SQLAlchemy 2.0 (ORM)
- SQLite (database, Postgres-ready via ORM-only access)
- Twilio (voice platform)
- Claude API (conversation engine)
- Deepgram (speech-to-text)
- Sarvam AI (text-to-speech)
- APScheduler (task scheduling)

### Frontend Stack
- React 19
- TanStack Router (file-based routing)
- React Query (server state)
- Zustand (client state)
- Tailwind CSS
- TypeScript
- Vite (dev server + build)

---

## 🔐 Security

- **Auth**: JWT tokens with bcrypt password hashing
- **API**: All patient-data routes require authentication
- **Webhooks**: Twilio requests validated via signature
- **Consent**: Hard opt-out gate — never call consents=false
- **Role-based access**: care_manager, clinician, admin roles

---

## 📱 Demo Workflow

1. **Login** as `test@hospital.com` / `TestPass123!`
2. **View Dashboard** → See KPIs (engagement rate, call completion, open escalations)
3. **Go to Patients** → Select a patient → Click "Initiate Call"
4. **Monitor Calls** → Visit "Calls" tab → Select call → View transcript + CSAT
5. **Handle Escalations** → "Escalations" tab → Red-flag cases → Assign or resolve

---

## 🧪 Testing

### Swagger API Docs
Visit `http://localhost:8000/docs` for interactive API testing.

### Database
Demo data includes:
- 2 patients (John Smith, Maria Garcia)
- 4 chronic conditions (Type 2 DM, HTN, COPD, Asthma)
- 2 care plans with disease protocols
- 1 demo care team user

### Voice Testing
Requires valid Twilio credentials (set in `.env`). Without them:
- `/api/outreach-calls/initiate` creates a record but fails at Twilio step
- All other endpoints work without Twilio

---

## 📈 Next Steps

### To Scale
1. **Postgres**: Swap SQLite in `database.py` (ORM-only, no code changes needed)
2. **Real appointments**: Replace mock availability in `appointment_service.py`
3. **EMR integration**: Build connectors to patient data sources
4. **SMS/WhatsApp**: Add channels to `OutreachCall.channel` enum
5. **Advanced analytics**: Query escalation trends, adherence by condition

### To Deploy
1. Backend: Docker + Cloud Run / Heroku / EC2
2. Frontend: Vercel / Netlify / S3 + CloudFront
3. Database: Cloud SQL / RDS
4. Secrets: Environment variables via cloud provider

---

## 📞 Support

- **Swagger Docs**: `http://localhost:8000/docs`
- **Frontend**: `http://localhost:5173` (dev mode auto-reload)
- **Logs**: Check terminal output for detailed request/response logs
- **Demo credentials**: `test@hospital.com` / `TestPass123!`

---

**Deployment Status: Ready for Testing** ✅
