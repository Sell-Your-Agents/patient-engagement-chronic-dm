import { RootRoute, Router, Route } from '@tanstack/react-router'
import { RootLayout } from './pages/RootLayout'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { PatientListPage } from './pages/PatientListPage'
import { PatientDetailPage } from './pages/PatientDetailPage'
import { EscalationQueuePage } from './pages/EscalationQueuePage'
import { EscalationDetailPage } from './pages/EscalationDetailPage'
import { AppointmentsPage } from './pages/AppointmentsPage'
import { CallsPage } from './pages/CallsPage'
import { DoctorsPage } from './pages/DoctorsPage'
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

// Escalations
const escalationListRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/escalations',
  component: EscalationQueuePage,
})

const escalationDetailRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/escalations/$id',
  component: EscalationDetailPage,
})

// Appointments
const appointmentListRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/appointments',
  component: AppointmentsPage,
})

// Calls (inbound + outbound)
const callListRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/calls',
  component: CallsPage,
})

// Doctors
const doctorsRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/doctors',
  component: DoctorsPage,
})

// Create route tree
const routeTree = rootRoute.addChildren([
  loginRoute,
  dashboardRoute,
  patientListRoute,
  patientDetailRoute,
  escalationListRoute,
  escalationDetailRoute,
  appointmentListRoute,
  callListRoute,
  doctorsRoute,
])

// Create router
export const router = new Router({ routeTree, basepath: ROUTER_BASEPATH })

// Register router for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
