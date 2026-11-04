# Patient Engagement Frontend

React 19 + TanStack Router + React Query dashboard for patient engagement system.

## Setup

```bash
cd frontend
npm install
npm run dev
```

Visit `http://localhost:5173`

## Features

- **Login Page** — JWT authentication
- **Dashboard** — KPI metrics (engagement rate, call completion, CSAT, etc.)
- **Patients** — Patient list and details (expandable)
- **Escalations** — Red-flag case queue with assignment/resolution
- **Appointments** — Schedule and confirm appointments  
- **Calls** — Outreach call log with transcripts

## Architecture

- **React Router** — File-based routing (`src/routes/`)
- **React Query** — Server state management with automatic refetching
- **Zustand** — Auth state management
- **Tailwind CSS** — Styling
- **TypeScript** — Type safety

## API Integration

- Backend runs on `http://localhost:8000`
- Vite proxy routes `/api/*` to backend
- API client in `src/lib/apiClient.ts` handles JWT auth

## Login Credentials

```
Email: test@hospital.com
Password: TestPass123!
```

(Register via signup form)
