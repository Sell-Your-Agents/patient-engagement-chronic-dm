import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Outlet, useNavigate, useLocation } from '@tanstack/react-router'
import { useAuthStore } from '../store/authStore'
import { useThemeStore } from '../store/themeStore'
import { useEscalations } from '../hooks/useEscalations'
import { useCalls, useCallbacks, isLiveCall } from '../hooks/useCalls'
import { useClinicInfo } from '../hooks/useClinic'
import { usePatients } from '../hooks/usePatients'
import { useDoctors } from '../hooks/useClinic'
import { Icon, type IconName } from '../components/Icon'
import { initials } from '../components/ui'
import { Toaster } from '../components/toast'
import { openCallbacks } from '../lib/nav'

type NavItem = { to: string; label: string; icon: IconName; exact?: boolean; key?: string; badge?: boolean }

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', exact: true, key: '1' },
  { to: '/patients', label: 'Patients', icon: 'users', key: '2' },
  { to: '/diseases', label: 'Chronic Conditions', icon: 'heart', key: '3' },
  { to: '/doctors', label: 'Doctors', icon: 'stethoscope', key: '4' },
  { to: '/calls', label: 'Call Logs', icon: 'phone', key: '5' },
  { to: '/appointments', label: 'Appointments', icon: 'calendar', key: '6' },
  { to: '/escalations', label: 'Escalations', icon: 'alert', key: '7', badge: true },
  { to: '/call-agent', label: 'Call the Agent', icon: 'phoneCall', key: '8' },
]
const SETTINGS_ITEM: NavItem = { to: '/settings', label: 'Settings', icon: 'settings', key: '9' }

const COLLAPSE_KEY = 'sidebar_collapsed'



export function RootLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { isAuthenticated } = useAuthStore()

  useEffect(() => {
    if (!isAuthenticated && location.pathname !== '/login') navigate({ to: '/login' })
  }, [isAuthenticated, navigate, location.pathname])

  return (
    <>
      {!isAuthenticated || location.pathname === '/login' ? <Outlet /> : <AppShell />}
      <Toaster />
    </>
  )
}

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

function isTyping(el: EventTarget | null) {
  const t = el as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
}

function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const { user } = useAuthStore()
  const { data: info } = useClinicInfo()
  const { data: escalations } = useEscalations()
  const openEsc = (escalations || []).filter((e) => e.status !== 'resolved').length

  const setMini = (v: boolean) => {
    setCollapsed(v)
    try {
      localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0')
    } catch {
      // ignore
    }
  }

  useEffect(() => setMobileOpen(false), [location.pathname])

  useEffect(() => {
    const openSide = () => setMobileOpen(true)
    const openPal = () => setPaletteOpen(true)
    window.addEventListener('open-sidebar', openSide)
    window.addEventListener('open-palette', openPal)
    return () => {
      window.removeEventListener('open-sidebar', openSide)
      window.removeEventListener('open-palette', openPal)
    }
  }, [])

  // Global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
        return
      }
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
      if (document.querySelector('.sheet, .modal-bg, .pal')) return
      const all = [...NAV_ITEMS, SETTINGS_ITEM]
      const hit = all.find((n) => n.key === e.key)
      if (hit) {
        navigate({ to: hit.to })
        return
      }
      if (e.key === '/') {
        e.preventDefault()
        window.dispatchEvent(new Event('focus-search'))
      } else if (e.key === '[') {
        setMini(!readCollapsed())
      } else if (e.key.toLowerCase() === 's') {
        openCallbacks(navigate)
      } else if (e.key.toLowerCase() === 'b') {
        navigate({ to: '/appointments' })
      } else if (e.key.toLowerCase() === 't') {
        useThemeStore.getState().toggleMode()
      } else if (e.key === '?') {
        setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  const isActive = (item: NavItem) => (item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to))
  const mini = collapsed && !mobileOpen

  const navLink = (item: NavItem) => {
    const active = isActive(item)
    const count = item.badge ? openEsc : 0
    return (
      <Link key={item.to} to={item.to} className={`nv ${active ? 'on' : ''}`} aria-current={active ? 'page' : undefined}>
        <Icon name={item.icon} className="h-[18px] w-[18px]" />
        <span>{item.label}</span>
        {count > 0 ? <i className="bd">{count}</i> : item.key && <i className="k">{item.key}</i>}
        <i className="tip">
          {item.label}
          {count > 0 ? ` · ${count}` : ''}
        </i>
      </Link>
    )
  }

  return (
    <div className={`app ${mini ? 'mini' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
      {mobileOpen && <div className="overlay" onClick={() => setMobileOpen(false)} />}
      <aside className="side">
        <div className="brand">
          <button className="brand-btn" onClick={() => mini && setMini(false)} title={mini ? 'Expand sidebar  [' : 'PatientPulse'} aria-label="Expand sidebar">
            <span className="mark">
              <Icon name="pulse" className="h-5 w-5 text-white" strokeWidth={2.4} />
            </span>
            <span className="expand">
              <Icon name="chevronsRight" className="h-5 w-5" />
            </span>
          </button>
          <div className="brand-txt">
            <b>PatientPulse</b>
            <span>{info?.clinic_name || 'Care team console'}</span>
          </div>
          <button className="sb-toggle" onClick={() => setMini(true)} title="Collapse sidebar  [" aria-label="Collapse sidebar">
            <Icon name="chevronsLeft" className="h-[18px] w-[18px]" />
          </button>
        </div>
        <div className="navlbl">Workspace</div>
        <nav className="sidenav" aria-label="Main">
          {NAV_ITEMS.map(navLink)}
        </nav>
        <AgentCard />
        <nav className="sidenav mt-3" aria-label="Preferences">
          {navLink(SETTINGS_ITEM)}
        </nav>
        <div className="user">
          <span className="av me">{initials(user?.name || user?.email || '?')}</span>
          <div className="min-w-0">
            <b className="block truncate">{user?.name || 'User'}</b>
            <small className="truncate capitalize">{user?.role?.replace(/_/g, ' ') || 'Care team'}</small>
          </div>
        </div>
      </aside>

      <main>
        <div key={location.pathname} className="wrap fade">
          <Outlet />
        </div>
      </main>

      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} setMini={setMini} />}
    </div>
  )
}

function AgentCard() {
  const { data: info } = useClinicInfo()
  const { data: calls } = useCalls()
  const { data: callbacks } = useCallbacks()
  const live = (calls || []).filter(isLiveCall).length
  const queued = (callbacks || []).filter((c) => c.status === 'pending').length
  const agent = info?.agent_name || 'Agent'
  return (
    <div className="agent">
      <div className="row">
        <span>AI agent</span>
        <span className="live">
          <i className="dot" /> Live
        </span>
      </div>
      <b>{agent} is online</b>
      <p>
        {live} call{live === 1 ? '' : 's'} in progress · {queued} callback{queued === 1 ? '' : 's'} queued
      </p>
      <Link to="/call-agent" className="btn">
        <Icon name="phone" className="h-4 w-4" /> Talk to {agent}
      </Link>
      <Link to="/call-agent" className="mini-agent" title={`${agent} is online`}>
        <Icon name="bot" className="h-[18px] w-[18px]" />
      </Link>
    </div>
  )
}

type Cmd = { label: string; hint: string; icon: IconName; run: () => void }

function CommandPalette({ onClose, setMini }: { onClose: () => void; setMini: (v: boolean) => void }) {
  const navigate = useNavigate()
  const { data: patients } = usePatients(0, 100)
  const { data: doctors } = useDoctors()
  const { toggleMode, setAccent, accent } = useThemeStore()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => inputRef.current?.focus(), [])

  const all: Cmd[] = useMemo(
    () => [
      ...[...NAV_ITEMS, SETTINGS_ITEM].map((n) => ({ label: `Go to ${n.label}`, hint: n.key || '', icon: n.icon, run: () => navigate({ to: n.to }) })),
      { label: 'Open scheduled callbacks', hint: 'S', icon: 'clock' as IconName, run: () => openCallbacks(navigate) },
      { label: 'Toggle dark mode', hint: 'T', icon: 'moon' as IconName, run: toggleMode },
      { label: accent === 'green' ? 'Switch to blue theme' : 'Switch to green theme', hint: 'Theme', icon: 'settings' as IconName, run: () => setAccent(accent === 'green' ? 'blue' : 'green') },
      { label: 'Collapse / expand sidebar', hint: '[', icon: 'chevronsLeft' as IconName, run: () => setMini(!readCollapsed()) },
      ...(patients || []).map((p) => ({
        label: `Open ${p.first_name} ${p.last_name}`,
        hint: p.mrn,
        icon: 'users' as IconName,
        run: () => navigate({ to: '/patients/$id', params: { id: String(p.id) } }),
      })),
      ...(doctors || []).map((d) => ({ label: `Roster · ${d.name}`, hint: d.specialty, icon: 'stethoscope' as IconName, run: () => navigate({ to: '/doctors' }) })),
    ],
    [patients, doctors, navigate, toggleMode, setAccent, accent, setMini],
  )
  const term = q.trim().toLowerCase()
  const results = all.filter((c) => !term || c.label.toLowerCase().includes(term) || c.hint.toLowerCase().includes(term)).slice(0, 9)

  const run = (c: Cmd | undefined) => {
    if (!c) return
    onClose()
    c.run()
  }

  return (
    <div className="pal" onClick={onClose}>
      <div className="box" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setActive(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(a + 1, results.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(a - 1, 0))
            } else if (e.key === 'Enter') run(results[active])
          }}
          placeholder="Type a command, patient, doctor…"
          aria-label="Command palette"
        />
        <div className="res">
          {results.length === 0 ? (
            <div className="empty">Nothing matches</div>
          ) : (
            results.map((c, i) => (
              <button key={c.label} className={i === active ? 'act' : ''} onMouseEnter={() => setActive(i)} onClick={() => run(c)}>
                <span className="ico mute !h-7 !w-7">
                  <Icon name={c.icon} className="h-4 w-4" />
                </span>
                {c.label}
                <small>{c.hint}</small>
              </button>
            ))
          )}
        </div>
        <div className="foot">
          <span><kbd className="k">↵</kbd> run</span>
          <span><kbd className="k">Esc</kbd> close</span>
          <span><kbd className="k">1–9</kbd> pages</span>
          <span><kbd className="k">/</kbd> search</span>
          <span><kbd className="k">[</kbd> sidebar</span>
          <span><kbd className="k">T</kbd> dark mode</span>
        </div>
      </div>
    </div>
  )
}
