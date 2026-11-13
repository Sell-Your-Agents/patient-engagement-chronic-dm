import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { Icon, type IconName } from './Icon'
import { usePatients } from '../hooks/usePatients'
import { useAuthStore } from '../store/authStore'
import { useThemeStore, resolvedMode } from '../store/themeStore'
import { openCallbacks, openPalette } from '../lib/nav'
import { NotificationBell } from './NotificationBell'

/* ------------------------------------------------------------------ */
/* Page header: date line, title, search, theme, palette, bell, user  */
/* ------------------------------------------------------------------ */

export function todayLabel() {
  return new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  back?: { to: string; label: string }
}) {
  return (
    <>
      <div className="top">
        <div className="flex min-w-0 items-center gap-3">
          <button className="menu no-print" onClick={() => window.dispatchEvent(new Event('open-sidebar'))} title="Open menu">
            <Icon name="menu" className="h-[18px] w-[18px]" />
          </button>
          <div className="min-w-0">
            <div className="date">{todayLabel()}</div>
            <h1 className="truncate">{title}</h1>
          </div>
        </div>
        <div className="tools no-print">
          <GlobalSearch />
          <ThemeToggle />
          <button className="ibtn" onClick={openPalette} title="Command palette  Ctrl+K">
            <Icon name="terminal" className="h-[18px] w-[18px]" />
          </button>
          <NotificationBell />
          <UserBadge />
        </div>
      </div>
      {(back || subtitle || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-[13.5px] text-ink-muted">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            {back && (
              <Link to={back.to} className="btn sm no-print">
                <Icon name="arrowLeft" className="h-3.5 w-3.5" /> {back.label}
              </Link>
            )}
            {subtitle && <span>{subtitle}</span>}
          </div>
          {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
    </>
  )
}

export function ThemeToggle() {
  const { mode, toggleMode } = useThemeStore()
  const dark = resolvedMode(mode) === 'dark'
  return (
    <button className="ibtn" onClick={toggleMode} title={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
      <Icon name={dark ? 'sun' : 'moon'} className="h-[18px] w-[18px]" />
    </button>
  )
}

function UserBadge() {
  const { user } = useAuthStore()
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button className="av me !h-[42px] !w-[42px]" onClick={() => setOpen((o) => !o)} title={user?.name || 'Account'}>
        {initials(user?.name || user?.email || '?')}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="card absolute right-0 top-[50px] z-40 w-64 overflow-hidden shadow-lift">
            <div className="flex items-center gap-3 border-b border-line p-4">
              <span className="av me">{initials(user?.name || '?')}</span>
              <div className="min-w-0">
                <b className="block truncate">{user?.name || 'User'}</b>
                <small className="block truncate text-ink-muted">{user?.email}</small>
              </div>
            </div>
            <div className="flex flex-col gap-1 p-2">
              <Link to="/settings" className="btn !justify-start border-transparent" onClick={() => setOpen(false)}>
                <Icon name="settings" className="h-4 w-4" /> Settings
              </Link>
              <button className="btn d !justify-start border-transparent" onClick={() => useAuthStore.getState().logout()}>
                <Icon name="logout" className="h-4 w-4" /> Sign out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

type QuickAction = { label: string; hint: string; icon: IconName; tone: Tone; key: string; run: () => void }

/**
 * Header search. Clicking it with nothing typed shows the quick actions;
 * typing searches patients by name, MRN or phone. "/" focuses it from anywhere.
 */
export function GlobalSearch() {
  const navigate = useNavigate()
  const { data: patients } = usePatients(0, 100)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const focus = () => inputRef.current?.focus()
    window.addEventListener('focus-search', focus)
    return () => window.removeEventListener('focus-search', focus)
  }, [])

  const actions: QuickAction[] = [
    { label: 'Call a patient', hint: 'The agent dials and runs the check-in', icon: 'phone', tone: 'a', key: '2', run: () => navigate({ to: '/patients' }) },
    { label: 'Appointments', hint: 'Book, confirm or cancel visits', icon: 'calendar', tone: 'violet', key: 'B', run: () => navigate({ to: '/appointments' }) },
    { label: 'Scheduled callbacks', hint: 'Callers waiting to be called back', icon: 'clock', tone: 'warn', key: 'S', run: () => openCallbacks(navigate) },
    { label: 'Command palette', hint: 'Jump anywhere, run actions', icon: 'terminal', tone: 'mute', key: 'Ctrl K', run: openPalette },
  ]

  const term = q.trim().toLowerCase()
  const results = useMemo(() => {
    if (!term) return []
    return (patients || [])
      .filter(
        (p) =>
          `${p.first_name} ${p.last_name}`.toLowerCase().includes(term) ||
          p.mrn.toLowerCase().includes(term) ||
          p.phone_number.replace(/\s/g, '').includes(term.replace(/\s/g, '')),
      )
      .slice(0, 6)
  }, [term, patients])
  const count = term ? results.length : actions.length

  const close = () => {
    setQ('')
    setOpen(false)
    inputRef.current?.blur()
  }
  const pick = (i: number) => {
    if (term) {
      const p = results[i]
      if (!p) return
      close()
      navigate({ to: '/patients/$id', params: { id: String(p.id) } })
    } else {
      const a = actions[i]
      if (!a) return
      close()
      a.run()
    }
  }

  return (
    <div className="search">
      <Icon name="search" className="h-4 w-4" />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setActive(0)
          setOpen(true)
        }}
        onFocus={() => {
          setActive(0)
          setOpen(true)
        }}
        onClick={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setActive((a) => Math.min(a + 1, count - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            pick(active)
          } else if (e.key === 'Escape') close()
        }}
        aria-label="Search patients or pick a quick action"
        placeholder="Search patient, MRN or phone"
        autoComplete="off"
      />
      <kbd>/</kbd>
      {open && (
        <div className="sres">
          {term ? (
            <>
              <div className="h">Patients</div>
              {results.length === 0 ? (
                <div className="empty">No patient matches “{q.trim()}”</div>
              ) : (
                results.map((p, i) => (
                  <button key={p.id} className={i === active ? 'act' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(i)} onMouseEnter={() => setActive(i)}>
                    <Avatar name={`${p.first_name} ${p.last_name}`} size={30} />
                    <span className="min-w-0">
                      <b className="block truncate">
                        {p.first_name} {p.last_name}
                      </b>
                      <small className="block truncate text-ink-muted">
                        {p.mrn} · {p.phone_number}
                      </small>
                    </span>
                  </button>
                ))
              )}
            </>
          ) : (
            <>
              <div className="h">Quick actions</div>
              {actions.map((a, i) => (
                <button key={a.label} className={i === active ? 'act' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(i)} onMouseEnter={() => setActive(i)}>
                  <span className={`ico ${a.tone}`}>
                    <Icon name={a.icon} className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate">{a.label}</b>
                    <small className="block truncate text-ink-muted">{a.hint}</small>
                  </span>
                  <kbd className="k shrink-0">{a.key}</kbd>
                </button>
              ))}
              <div className="h !normal-case !tracking-normal">Or start typing to find a patient</div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Building blocks                                                    */
/* ------------------------------------------------------------------ */

export function initials(name: string | null | undefined) {
  const parts = (name || '?').replace(/^Dr\.?\s*/i, '').trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toUpperCase() || '?'
}

/** Initials avatar with a stable theme-aware tone per name. */
export function Avatar({ name, size = 36 }: { name: string | null | undefined; size?: number }) {
  const k = [...(name || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % 6
  return (
    <span className={`av t${k}`} style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.34)) }}>
      {initials(name)}
    </span>
  )
}

/** Tiny line chart; the last point is emphasised. */
export function Spark({
  data,
  color = 'var(--accent)',
  width = 70,
  height = 24,
  className = 'spark',
  style,
}: {
  data: number[]
  color?: string
  width?: number
  height?: number
  className?: string
  style?: React.CSSProperties
}) {
  if (data.length < 2) return null
  const mx = Math.max(...data)
  const mn = Math.min(...data)
  const pts = data.map((v, i) => [(i / (data.length - 1)) * width, height - 2 - ((v - mn) / (mx - mn || 1)) * (height - 4)] as const)
  const last = pts[pts.length - 1]!
  return (
    <svg className={className} style={style} width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill={color} />
    </svg>
  )
}

export type Tone = 'a' | 'ok' | 'warn' | 'bad' | 'violet' | 'info' | 'mute'
const TONE_COLOR: Record<Tone, string> = {
  a: 'var(--accent)',
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  bad: 'var(--bad)',
  violet: 'var(--violet)',
  info: 'var(--info)',
  mute: 'var(--mute)',
}

/** KPI tile: label + icon chip, big number, hint line, optional sparkline. */
export function Kpi({
  label,
  value,
  hint,
  icon,
  tone = 'a',
  trend,
  dir,
  valueTone,
  to,
}: {
  to?: string
  label: string
  value: ReactNode
  hint?: ReactNode
  icon: IconName
  tone?: Tone
  trend?: number[]
  dir?: 'up' | 'dn'
  valueTone?: 'bad'
}) {
  const body = (
    <>
      <div className="lbl">
        <span>{label}</span>
        <span className={`ico ${tone}`}>
          <Icon name={icon} className="h-[17px] w-[17px]" />
        </span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="v" style={valueTone === 'bad' ? { color: 'var(--bad)' } : undefined}>
          {value}
        </div>
        {trend && <Spark data={trend} color={TONE_COLOR[tone]} className="mb-1 shrink-0" />}
      </div>
      {hint && (
        <div className={`s ${dir || ''}`}>
          {dir === 'up' && <Icon name="trending" className="h-3.5 w-3.5 shrink-0" />}
          <span>{hint}</span>
        </div>
      )}
    </>
  )
  if (to)
    return (
      <Link to={to} className="card kpi kpi-link" title={`Open ${label.toLowerCase()}`}>
        {body}
      </Link>
    )
  return <div className="card kpi">{body}</div>
}

/** Card with a header row. */
export function Panel({
  title,
  subtitle,
  right,
  children,
  className = '',
}: {
  title?: ReactNode
  subtitle?: ReactNode
  right?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`card ${className}`}>
      {(title || right) && (
        <div className="card-h">
          <div className="min-w-0">
            {title && <h3>{title}</h3>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </div>
  )
}

const STATUS: Record<string, { cls: string; label?: string }> = {
  completed: { cls: 'ok' },
  resolved: { cls: 'ok' },
  confirmed: { cls: 'ok' },
  active: { cls: 'ok' },
  booked: { cls: 'info' },
  'in-progress': { cls: 'info', label: 'In progress' },
  in_progress: { cls: 'info', label: 'In progress' },
  initiated: { cls: 'info' },
  calling: { cls: 'info' },
  ringing: { cls: 'info' },
  requested: { cls: 'warn' },
  acknowledged: { cls: 'warn' },
  pending: { cls: 'warn' },
  paused: { cls: 'warn' },
  'no-answer': { cls: 'warn', label: 'No answer' },
  no_answer: { cls: 'warn', label: 'No answer' },
  open: { cls: 'bad' },
  failed: { cls: 'bad' },
  busy: { cls: 'bad' },
  no_booking: { cls: 'mute', label: 'No booking' },
  cancelled: { cls: 'mute' },
  canceled: { cls: 'mute', label: 'Cancelled' },
  inactive: { cls: 'mute' },
  discharged: { cls: 'mute' },
}

export function StatusBadge({ status, dotted = true }: { status: string; dotted?: boolean }) {
  const key = status?.toLowerCase() || ''
  const s = STATUS[key] ?? { cls: 'mute' }
  const label = s.label ?? key.replace(/[-_]/g, ' ')
  return <span className={`pill ${s.cls} ${dotted ? 'dotted' : ''} capitalize`}>{label}</span>
}

export const SEVERITY_TONE: Record<string, Tone> = { urgent: 'bad', critical: 'bad', high: 'warn', medium: 'info', low: 'mute' }

export function SeverityBadge({ severity, fixed = false }: { severity: string; fixed?: boolean }) {
  const tone = SEVERITY_TONE[severity?.toLowerCase()] ?? 'mute'
  return (
    <span className={`pill ${tone} capitalize`} style={fixed ? { width: 70, justifyContent: 'center' } : undefined}>
      {severity}
    </span>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="lbl">{label}</div>
      <div className="mt-1 font-bold">{children}</div>
    </div>
  )
}

export function EmptyState({ icon, text, action }: { icon: IconName; text: string; action?: ReactNode }) {
  return (
    <div className="empty flex flex-col items-center gap-3">
      <span className="ico a !h-11 !w-11 !rounded-xl">
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <span className="max-w-sm">{text}</span>
      {action}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Loading                                                            */
/* ------------------------------------------------------------------ */

export function Spinner({ className = '' }: { className?: string }) {
  return <span className={`spinner ${className}`} aria-hidden="true" />
}

export function Skeleton({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skel ${className}`} style={style} />
}

export function TableSkeleton({ rows = 6 }: { rows?: number; cols?: number }) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3.5 border-t border-line-soft px-[18px] py-3.5 first:border-t-0">
          <Skeleton style={{ width: 36, height: 36, borderRadius: '50%' }} />
          <div className="flex-1 space-y-2">
            <Skeleton style={{ width: '40%', height: 11 }} />
            <Skeleton style={{ width: '60%', height: 9 }} />
          </div>
          <Skeleton style={{ width: 80, height: 20, borderRadius: 99 }} />
        </div>
      ))}
    </div>
  )
}

/** Page skeleton shown while the page's first data loads. */
export function Loader({ text = 'Loading…', variant = 'table' }: { text?: string; variant?: 'table' | 'cards' | 'detail' | 'dashboard' | 'list' }) {
  return (
    <div aria-busy="true" aria-label={text}>
      <div className="top">
        <div>
          <Skeleton style={{ width: 180, height: 12 }} />
          <Skeleton style={{ width: 240, height: 26, marginTop: 10 }} />
        </div>
        <Skeleton style={{ width: 300, height: 42 }} />
      </div>
      {variant !== 'cards' && (
        <div className="grid g4 mb-3.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card kpi">
              <Skeleton style={{ width: 100, height: 10 }} />
              <Skeleton style={{ width: 60, height: 28, marginTop: 12 }} />
              <Skeleton style={{ width: 120, height: 10, marginTop: 8 }} />
            </div>
          ))}
        </div>
      )}
      {variant === 'cards' ? (
        <div className="grid g3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card doc">
              <div className="flex items-center gap-3">
                <Skeleton style={{ width: 46, height: 46, borderRadius: '50%' }} />
                <div className="flex-1 space-y-2">
                  <Skeleton style={{ width: '60%', height: 13 }} />
                  <Skeleton style={{ width: '40%', height: 10 }} />
                </div>
              </div>
              <Skeleton style={{ height: 52 }} />
              <Skeleton style={{ height: 10, width: '70%' }} />
            </div>
          ))}
        </div>
      ) : (
        <div className="card">
          <TableSkeleton />
        </div>
      )}
    </div>
  )
}

export function ErrorState({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className="card flex flex-wrap items-center gap-4 p-5">
      <span className="ico bad !h-11 !w-11">
        <Icon name="alert" className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <b className="block">{text}</b>
        <span className="text-[13px] text-ink-muted">Check that the backend is running, then try again.</span>
      </div>
      <button className="btn" onClick={onRetry ?? (() => window.location.reload())}>
        Retry
      </button>
    </div>
  )
}

/** Right-hand slide-over panel. Esc or a click on the backdrop closes it. */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  narrow,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  narrow?: boolean
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="sheet" onClick={onClose} role="dialog" aria-modal="true">
      <div className={`drawer ${narrow ? 'narrow' : ''}`} onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="min-w-0">
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="btn ic" onClick={onClose} title="Close (Esc)">
            <Icon name="x" className="h-4 w-4" />
          </button>
        </header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  )
}

/** Centered dialog used for edit forms. */
export function Modal({ open, onClose, title, subtitle, children }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-black">{title}</h2>
            {subtitle && <p className="text-[13px] text-ink-muted">{subtitle}</p>}
          </div>
          <button className="btn ic" onClick={onClose} title="Close">
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** Inbound / outbound label with an arrow icon. */
export function DirectionLabel({ direction }: { direction: 'inbound' | 'outbound' | string }) {
  return direction === 'inbound' ? (
    <span className="inline-flex items-center gap-1.5 font-bold text-info">
      <Icon name="phoneIncoming" className="h-[15px] w-[15px]" /> Inbound
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 font-bold text-brand">
      <Icon name="phoneOutgoing" className="h-[15px] w-[15px]" /> Outbound
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Formatting                                                         */
/* ------------------------------------------------------------------ */

/** Treat naive backend timestamps as UTC. */
export function utcDate(value: string) {
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`)
}

/** "Today, 9:42 AM" / "Fri 6 Nov, 6:10 PM" */
export function friendlyTime(value: string | null | undefined, utc = false) {
  if (!value) return '—'
  const d = utc ? utcDate(value) : new Date(value)
  const now = new Date()
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const sameDay = d.toDateString() === now.toDateString()
  const y = new Date(now)
  y.setDate(now.getDate() - 1)
  const tm = new Date(now)
  tm.setDate(now.getDate() + 1)
  if (sameDay) return `Today, ${time}`
  if (d.toDateString() === y.toDateString()) return `Yesterday, ${time}`
  if (d.toDateString() === tm.toDateString()) return `Tomorrow, ${time}`
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) })
  return `${day.replace(',', '')}, ${time}`
}

export function formatLength(seconds: number | null | undefined) {
  if (seconds == null) return '—'
  const m = Math.floor(seconds / 60)
  return m ? `${m}m ${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Compact one-line date for table cells, e.g. "Oct 15, 2:01 PM" (year only if not this year). */
export function formatShortDateTime(value: string | null | undefined, utc = false) {
  if (!value) return '—'
  const d = new Date(utc && !/[zZ]|[+-]\d\d:\d\d$/.test(value) ? `${value}Z` : value)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  })
}

// Backend `created_at` / call timestamps are naive UTC; clinic schedule times are naive local.
export function formatUtcDateTime(value: string | null | undefined) {
  if (!value) return '—'
  return formatDateTime(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`)
}

export function formatTime(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function formatDayLabel(value: string) {
  return new Date(value).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

export function callDuration(start: string | null, end: string | null) {
  if (!start || !end) return '—'
  const secs = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000)
  return secs >= 0 ? `${secs}s` : '—'
}


/**
 * Client-side pagination (plain function, so it is safe after early returns).
 * Keep `page` in the component's own useState; the page is clamped to the valid range.
 */
export function paginate<T>(items: T[], page: number, setPage: (n: number) => void, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const current = Math.min(Math.max(1, page), totalPages)
  const startIndex = (current - 1) * pageSize
  return {
    page: current,
    setPage,
    totalPages,
    total: items.length,
    from: items.length === 0 ? 0 : startIndex + 1,
    to: Math.min(startIndex + pageSize, items.length),
    pageItems: items.slice(startIndex, startIndex + pageSize),
  }
}

export function Pagination({
  paged,
  noun = 'items',
}: {
  paged: { page: number; setPage: (n: number) => void; totalPages: number; total: number; from: number; to: number }
  noun?: string
}) {
  const { page, setPage, totalPages, total, from, to } = paged
  if (total === 0) return null
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1).filter((n) => n === 1 || n === totalPages || Math.abs(n - page) <= 1)
  return (
    <div className="no-print flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-[12.5px] text-ink-muted">
      <span>
        Showing <b className="text-ink">{from}–{to}</b> of <b className="text-ink">{total}</b> {noun}
      </span>
      {totalPages > 1 && (
        <span className="flex items-center gap-1.5">
          <button className="btn sm" onClick={() => setPage(page - 1)} disabled={page === 1} title="Previous">‹</button>
          {pages.map((n, i) => (
            <span key={n} className="flex items-center gap-1.5">
              {i > 0 && n - pages[i - 1]! > 1 && <span>…</span>}
              <button className={`btn sm ${n === page ? 'p' : ''}`} onClick={() => setPage(n)}>
                {n}
              </button>
            </span>
          ))}
          <button className="btn sm" onClick={() => setPage(page + 1)} disabled={page === totalPages} title="Next">›</button>
        </span>
      )}
    </div>
  )
}
