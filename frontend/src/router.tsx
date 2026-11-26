import { RootRoute, Router, Route } from '@tanstack/react-router'
import { RootLayout } from './pages/RootLayout'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { PatientListPage } from './pages/PatientListPage'
import { PatientDetailPage } from './pages/PatientDetailPage'
import { KnowledgePage } from './pages/KnowledgePage'
import { FollowUpsPage } from './pages/FollowUpsPage'
import { AppointmentsPage } from './pages/AppointmentsPage'
import { CallsPage } from './pages/CallsPage'
import { CallDetailPage } from './pages/CallDetailPage'
import { DoctorsPage } from './pages/DoctorsPage'
import { CallAgentPage } from './pages/CallAgentPage'
import { SettingsPage } from './pages/SettingsPage'
import { ROUTER_BASEPATH } from './lib/paths'
import { parseFrom, type From } from './lib/backNav'

// Root route
const rootRoute = new RootRoute({
  component: RootLayout,
  beforeLoad: async () => {
    // Auth is checked in RootLayout
  },
})

// Login route (no auth required)
const loginRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
})

// Dashboard
const dashboardRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/',
  component: DashboardPage,
})

// Patients
const patientListRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/patients',
  component: PatientListPage,
})

const patientDetailRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/patients/$id',
  component: PatientDetailPage,
  // from: the page the patient was opened from (its back button returns there)
  validateSearch: (s: Record<string, unknown>): { from?: From } => (parseFrom(s.from) ? { from: parseFrom(s.from) } : {}),
})

// Clinic knowledge base (services, FAQs, policies the agent may share)
const knowledgeRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/knowledge',
  component: KnowledgePage,
})

// Follow-ups: people clinic staff must call back
const followUpsRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/follow-ups',
  component: FollowUpsPage,
  // patient: show only this patient's follow-ups; from: the page that link was on (a back button returns there)
  validateSearch: (s: Record<string, unknown>): { patient?: number; from?: From } => {
    const out: { patient?: number; from?: From } = {}
    const n = Number(s.patient)
    if (Number.isFinite(n) && n > 0) out.patient = n
    const from = parseFrom(s.from)
    if (from) out.from = from
    return out
  },
})

// Appointments
const appointmentListRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/appointments',
  component: AppointmentsPage,
  // doctor: filter by doctor; open: open this appointment's notes; call: open the appointment recorded on this call;
  // from: the page that link was on (a back button returns there)
  validateSearch: (s: Record<string, unknown>): { doctor?: number; patient?: number; open?: number; call?: number; from?: From } => {
    const out: { doctor?: number; patient?: number; open?: number; call?: number; from?: From } = {}
    const from = parseFrom(s.from)
    if (from) out.from = from
    for (const k of ['doctor', 'patient', 'open', 'call'] as const) {
      const n = Number(s[k])
      if (Number.isFinite(n) && n > 0) out[k] = n
    }
    return out
  },
})

// Call records
const callListRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/calls',
  component: CallsPage,
})

// One call: record, summary, next steps, transcript, recording
const callDetailRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/calls/$id',
  component: CallDetailPage,
  // from: the page the call was opened from (its back button returns there)
  validateSearch: (s: Record<string, unknown>): { from?: From } => (parseFrom(s.from) ? { from: parseFrom(s.from) } : {}),
})

// Doctors
const doctorsRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/doctors',
  component: DoctorsPage,
})

// Call the agent from the browser (Twilio Voice SDK, same path as a call to the clinic number)
const callAgentRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/call-agent',
  component: CallAgentPage,
})

const settingsRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
})

// Create route tree
const routeTree = rootRoute.addChildren([
  loginRoute,
  dashboardRoute,
  patientListRoute,
  patientDetailRoute,
  knowledgeRoute,
  followUpsRoute,
  appointmentListRoute,
  callListRoute,
  callDetailRoute,
  doctorsRoute,
  callAgentRoute,
  settingsRoute,
])

// Create router
export const router = new Router({ routeTree, basepath: ROUTER_BASEPATH })

// Register router for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
