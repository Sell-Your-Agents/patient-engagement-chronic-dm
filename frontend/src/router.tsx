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
})

// Appointments
const appointmentListRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/appointments',
  component: AppointmentsPage,
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
