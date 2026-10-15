import { RootRoute, Router, Route } from '@tanstack/react-router'
import { RootLayout } from './pages/RootLayout'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { PatientListPage } from './pages/PatientListPage'
import { PatientDetailPage } from './pages/PatientDetailPage'
import { EscalationQueuePage } from './pages/EscalationQueuePage'
import { EscalationDetailPage } from './pages/EscalationDetailPage'
import { AppointmentListPage } from './pages/AppointmentListPage'
import { OutreachCallListPage } from './pages/OutreachCallListPage'
import { ClinicDashboardPage } from './pages/clinic/ClinicDashboardPage'
import { MissedCallsPage } from './pages/clinic/MissedCallsPage'
import { ClinicCallsPage } from './pages/clinic/ClinicCallsPage'
import { ClinicAppointmentsPage } from './pages/clinic/ClinicAppointmentsPage'
import { DoctorsPage } from './pages/clinic/DoctorsPage'
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
  component: AppointmentListPage,
})

// Outreach Calls
const callListRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/calls',
  component: OutreachCallListPage,
})

// Missed-call callback agent
const clinicDashboardRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/clinic',
  component: ClinicDashboardPage,
})

const clinicMissedCallsRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/clinic/missed-calls',
  component: MissedCallsPage,
})

const clinicCallsRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/clinic/calls',
  component: ClinicCallsPage,
})

const clinicAppointmentsRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/clinic/appointments',
  component: ClinicAppointmentsPage,
})

const clinicDoctorsRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/clinic/doctors',
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
  clinicDashboardRoute,
  clinicMissedCallsRoute,
  clinicCallsRoute,
  clinicAppointmentsRoute,
  clinicDoctorsRoute,
])

// Create router
export const router = new Router({ routeTree, basepath: ROUTER_BASEPATH })

// Register router for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
