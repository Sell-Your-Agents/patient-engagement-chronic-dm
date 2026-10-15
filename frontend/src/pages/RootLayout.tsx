import { useEffect, useState } from 'react'
import { Link, Outlet, useNavigate, useLocation } from '@tanstack/react-router'
import { useAuthStore } from '../store/authStore'
import { usePatients, useInitiateCall } from '../hooks/usePatients'
import { Icon, type IconName } from '../components/Icon'
import { Logo, LogoMark } from '../components/Logo'
import { useCreateMissedCall, useStartCallback, apiErrorMessage } from '../hooks/useClinic'

type NavItem = { to: string; label: string; icon: IconName; exact?: boolean }

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Chronic Care',
    items: [
      { to: '/', label: 'Dashboard', icon: 'dashboard', exact: true },
      { to: '/patients', label: 'Patients', icon: 'users' },
      { to: '/calls', label: 'Call Logs', icon: 'phone' },
      { to: '/escalations', label: 'Escalations', icon: 'alert' },
      { to: '/appointments', label: 'Appointments', icon: 'calendar' },
    ],
  },
  {
    title: 'Missed-Call Agent',
    items: [
      { to: '/clinic', label: 'Callback Dashboard', icon: 'activity', exact: true },
      { to: '/clinic/missed-calls', label: 'Missed Calls', icon: 'phoneMissed' },
      { to: '/clinic/calls', label: 'Callback Logs', icon: 'messages' },
      { to: '/clinic/appointments', label: 'Bookings', icon: 'calendar' },
      { to: '/clinic/doctors', label: 'Doctors', icon: 'stethoscope' },
    ],
  },
]

const COLLAPSE_KEY = 'sidebar_collapsed'

export function RootLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { isAuthenticated } = useAuthStore()

  useEffect(() => {
    if (!isAuthenticated && location.pathname !== '/login') {
      navigate({ to: '/login' })
    }
  }, [isAuthenticated, navigate, location.pathname])

  if (!isAuthenticated || location.pathname === '/login') {
    return (
      <div className="clay-bg min-h-screen">
        <Outlet />
      </div>
    )
  }

  return <AppShell />
}

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

function AppShell() {
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)

  useEffect(() => {
    setMobileOpen(false)
    setQuickOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const open = () => setMobileOpen(true)
    window.addEventListener('open-sidebar', open)
    return () => window.removeEventListener('open-sidebar', open)
  }, [])

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1')
      } catch {
        // ignore storage errors
      }
      return !c
    })
  }

  const isActive = (item: NavItem) =>
    item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to)
  const inClinic = location.pathname.startsWith('/clinic')

  // On mobile the drawer is always shown expanded.
  const mini = collapsed && !mobileOpen

  return (
    <div className="app-frame clay-bg flex h-screen gap-4 overflow-hidden p-3 lg:p-4">
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/25 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar: always exactly the viewport height, never scrolls */}
      <aside
        className={`clay fixed inset-y-3 left-3 z-40 flex w-[248px] flex-col overflow-hidden px-3.5 py-4 transition-all duration-300 lg:static lg:h-full lg:shrink-0 ${
          mini ? 'lg:w-[80px] lg:px-2.5' : 'lg:w-[248px]'
        } ${mobileOpen ? 'translate-x-0' : '-translate-x-[120%] lg:translate-x-0'}`}
      >
        {/* Brand + collapse control */}
        {mini ? (
          <div className="flex shrink-0 flex-col items-center gap-2.5">
            <LogoMark size={42} />
            <button onClick={toggleCollapsed} className="clay-btn-ghost btn-icon !h-8 !w-8" title="Expand sidebar">
              <Icon name="panel" className="h-4 w-4 rotate-180" />
            </button>
          </div>
        ) : (
          <div className="flex shrink-0 items-center justify-between gap-3 px-1">
            <Logo />
            <button
              onClick={toggleCollapsed}
              className="clay-btn-ghost btn-icon hidden !h-8 !w-8 shrink-0 lg:inline-flex"
              title="Collapse sidebar"
            >
              <Icon name="panel" className="h-4 w-4" />
            </button>
            <button
              onClick={() => setMobileOpen(false)}
              className="clay-btn-ghost btn-icon !h-8 !w-8 shrink-0 lg:hidden"
              title="Close menu"
            >
              <Icon name="x" className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="mx-1 my-3.5 h-px shrink-0 bg-gradient-to-r from-transparent via-slate-300/70 to-transparent" />

        {/* Navigation */}
        <nav className="flex min-h-0 flex-col">
          {NAV_GROUPS.map((group, gi) => (
            <div key={group.title} className={`flex flex-col gap-0.5 ${gi > 0 ? 'mt-3' : ''}`}>
              {mini ? (
                gi > 0 && <div className="mx-2 mb-2 h-px bg-slate-300/60" />
              ) : (
                <p className="mb-1 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-muted">
                  {group.title}
                </p>
              )}
              {group.items.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  title={item.label}
                  className={`nav-item ${isActive(item) ? 'nav-item-active' : ''} ${
                    mini ? 'justify-center !px-0' : ''
                  }`}
                >
                  <Icon name={item.icon} className="h-[17px] w-[17px] shrink-0" />
                  {!mini && <span className="truncate">{item.label}</span>}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="mt-auto shrink-0 space-y-2.5 pt-4">
          {/* Full quick-call card only when there is vertical room; otherwise a button + pop-up */}
          {!mini && <div className="hidden tall:block">{inClinic ? <QuickCallback /> : <QuickCall />}</div>}
          <button
            onClick={() => setQuickOpen(true)}
            title={inClinic ? 'Quick callback' : 'Quick call'}
            className={`clay-btn w-full !py-2.5 ${mini ? '' : 'tall:hidden'}`}
          >
            <Icon name="phoneCall" className="h-4 w-4" />
            {!mini && <span>{inClinic ? 'Quick Callback' : 'Quick Call'}</span>}
          </button>
          <button
            onClick={() => useAuthStore.getState().logout()}
            title="Logout"
            className="flex h-10 w-full items-center justify-center gap-2 rounded-[14px] border border-dashed border-rose-300 text-sm font-bold text-rose-600 transition hover:bg-rose-50"
          >
            <Icon name="logout" className="h-4 w-4" />
            {!mini && <span>Logout</span>}
          </button>
        </div>
      </aside>

      {/* Main content: fixed frame, content scrolls inside without a visible bar */}
      <main className="clay h-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-5 md:p-6 lg:p-7">
        <Outlet />
      </main>

      {/* Quick call pop-up for short screens / collapsed sidebar */}
      {quickOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/25 backdrop-blur-sm" onClick={() => setQuickOpen(false)} />
          <div className="relative w-full max-w-sm">
            <button
              onClick={() => setQuickOpen(false)}
              className="clay-btn-ghost btn-icon absolute -right-2 -top-2 z-10 !h-8 !w-8 !rounded-full"
              title="Close"
            >
              <Icon name="x" className="h-4 w-4" />
            </button>
            <div className="clay p-2">{inClinic ? <QuickCallback /> : <QuickCall />}</div>
          </div>
        </div>
      )}
    </div>
  )
}

// Quick Call: start an outreach call for an existing patient (same API as "Initiate Call").
function QuickCall() {
  const { data: patients } = usePatients(0, 100)
  const { mutate: initiateCall, isPending } = useInitiateCall()
  const [patientId, setPatientId] = useState('')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const start = () => {
    if (!patientId) return
    setMessage(null)
    initiateCall(
      { patient_id: Number(patientId) },
      {
        onSuccess: () => setMessage({ ok: true, text: 'Call initiated' }),
        onError: (err: any) =>
          setMessage({ ok: false, text: err?.response?.data?.detail || 'Failed to start call' }),
      }
    )
  }

  return (
    <div className="clay-sm rounded-[20px] p-3.5">
      <div className="flex items-center gap-3">
        <span className="stat-bubble bubble-peach !h-9 !w-9 !rounded-xl">
          <Icon name="phone" className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-extrabold text-ink">Quick Call</p>
          <p className="text-[11px] text-ink-soft">Call a patient instantly</p>
        </div>
      </div>
      <select
        value={patientId}
        onChange={(e) => setPatientId(e.target.value)}
        className="clay-input mt-3 !py-2 !text-[13px]"
      >
        <option value="">Select patient...</option>
        {patients?.map((p) => (
          <option key={p.id} value={p.id}>
            {p.first_name} {p.last_name} · {p.phone_number}
          </option>
        ))}
      </select>
      <button onClick={start} disabled={!patientId || isPending} className="clay-btn mt-3 w-full">
        <Icon name="phoneCall" className="h-4 w-4" />
        {isPending ? 'Calling...' : 'Start Call'}
      </button>
      {message && (
        <p className={`mt-2 text-center text-[11px] font-semibold ${message.ok ? 'text-emerald-600' : 'text-rose-600'}`}>
          {message.text}
        </p>
      )}
    </div>
  )
}

// Quick Callback: log a missed number and have the clinic agent call it back right away.
function QuickCallback() {
  const { mutateAsync: createMissedCall } = useCreateMissedCall()
  const { mutateAsync: startCallback } = useStartCallback()
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const start = async () => {
    if (!phone.trim()) return
    setBusy(true)
    setMessage(null)
    try {
      const digits = phone.replace(/\s/g, '')
      const missed = await createMissedCall({ phone_number: digits.startsWith('+') ? digits : `+91${digits}` })
      await startCallback(missed.id)
      setMessage({ ok: true, text: 'Agent is calling back' })
      setPhone('')
    } catch (err) {
      setMessage({ ok: false, text: apiErrorMessage(err, 'Failed to start callback') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="clay-sm rounded-[20px] p-3.5">
      <div className="flex items-center gap-3">
        <span className="stat-bubble bubble-peach !h-9 !w-9 !rounded-xl">
          <Icon name="phoneMissed" className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-extrabold text-ink">Quick Callback</p>
          <p className="text-[11px] text-ink-soft">Call back a missed number</p>
        </div>
      </div>
      <div className="clay-input mt-3 flex items-center gap-2 !py-2">
        <span className="text-[13px] font-bold text-ink-soft">{phone.trim().startsWith('+') ? '' : '+91'}</span>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && start()}
          placeholder="Phone number..."
          inputMode="tel"
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-muted"
        />
      </div>
      <button onClick={start} disabled={!phone.trim() || busy} className="clay-btn mt-3 w-full">
        <Icon name="phoneCall" className="h-4 w-4" />
        {busy ? 'Calling...' : 'Start Callback'}
      </button>
      {message && (
        <p className={`mt-2 text-center text-[11px] font-semibold ${message.ok ? 'text-emerald-600' : 'text-rose-600'}`}>
          {message.text}
        </p>
      )}
    </div>
  )
}
