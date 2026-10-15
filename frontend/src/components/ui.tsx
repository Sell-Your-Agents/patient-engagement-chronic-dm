import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Icon, type IconName } from './Icon'
import { UserMenu } from './UserMenu'

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
  back?: { to: string; label: string }
}) {
  return (
    <div className="mb-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <button
            onClick={() => window.dispatchEvent(new Event('open-sidebar'))}
            className="clay-btn-ghost btn-icon no-print mt-1 shrink-0 lg:hidden"
            title="Open menu"
          >
            <Icon name="menu" className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            {back && (
              <Link
                to={back.to}
                className="mb-2 inline-flex items-center gap-1.5 text-xs font-bold text-ink-muted transition hover:text-orange-600"
              >
                <Icon name="arrowLeft" className="h-3.5 w-3.5" /> {back.label}
              </Link>
            )}
            <h1 className="truncate text-[24px] font-extrabold leading-tight tracking-tight text-ink md:text-[28px]">
              {title}
            </h1>
            {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
          </div>
        </div>
        <div className="no-print flex shrink-0 items-center gap-3">
          {actions && <div className="hidden items-center gap-3 md:flex">{actions}</div>}
          <UserMenu />
        </div>
      </div>
      {actions && <div className="no-print mt-4 flex flex-wrap items-center gap-3 md:hidden">{actions}</div>}
    </div>
  )
}

export type Tint = 'peach' | 'mint' | 'lavender' | 'coral' | 'amber' | 'sky' | 'rose' | 'teal'

export function StatCard({
  label,
  value,
  icon,
  tint,
}: {
  label: string
  value: ReactNode
  icon: IconName
  tint: Tint
}) {
  return (
    <div className={`stat-card tint-${tint}`}>
      <div className={`stat-bubble bubble-${tint}`}>
        <Icon name={icon} className="h-5 w-5" strokeWidth={2.2} />
      </div>
      <div className="min-w-0">
        <p className="line-clamp-2 text-[12.5px] font-semibold leading-tight text-ink-soft" title={label}>{label}</p>
        <p className="mt-0.5 text-[21px] font-extrabold leading-tight tracking-tight text-ink">{value}</p>
      </div>
    </div>
  )
}

export function Panel({
  title,
  right,
  children,
  className = '',
}: {
  title?: string
  right?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`clay overflow-hidden ${className}`}>
      {(title || right) && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-4">
          {title && <p className="card-title">{title}</p>}
          {right}
        </div>
      )}
      {children}
    </div>
  )
}

const STATUS_STYLES: Record<string, { cls: string; icon: IconName }> = {
  completed: { cls: 'bg-emerald-100 text-emerald-700', icon: 'checkCircle' },
  resolved: { cls: 'bg-emerald-100 text-emerald-700', icon: 'checkCircle' },
  confirmed: { cls: 'bg-emerald-100 text-emerald-700', icon: 'checkCircle' },
  active: { cls: 'bg-emerald-100 text-emerald-700', icon: 'checkCircle' },
  'in-progress': { cls: 'bg-sky-100 text-sky-700', icon: 'activity' },
  in_progress: { cls: 'bg-sky-100 text-sky-700', icon: 'activity' },
  initiated: { cls: 'bg-sky-100 text-sky-700', icon: 'phone' },
  requested: { cls: 'bg-amber-100 text-amber-700', icon: 'clock' },
  acknowledged: { cls: 'bg-amber-100 text-amber-700', icon: 'clock' },
  'no-answer': { cls: 'bg-amber-100 text-amber-700', icon: 'clock' },
  open: { cls: 'bg-rose-100 text-rose-700', icon: 'alert' },
  pending: { cls: 'bg-amber-100 text-amber-700', icon: 'clock' },
  calling: { cls: 'bg-sky-100 text-sky-700', icon: 'phoneCall' },
  ringing: { cls: 'bg-sky-100 text-sky-700', icon: 'phoneCall' },
  booked: { cls: 'bg-emerald-100 text-emerald-700', icon: 'checkCircle' },
  no_booking: { cls: 'bg-slate-200 text-slate-600', icon: 'xCircle' },
  no_answer: { cls: 'bg-amber-100 text-amber-700', icon: 'phoneMissed' },
  failed: { cls: 'bg-rose-100 text-rose-700', icon: 'xCircle' },
  busy: { cls: 'bg-rose-100 text-rose-700', icon: 'xCircle' },
  cancelled: { cls: 'bg-slate-200 text-slate-600', icon: 'xCircle' },
  inactive: { cls: 'bg-slate-200 text-slate-600', icon: 'xCircle' },
  discharged: { cls: 'bg-slate-200 text-slate-600', icon: 'xCircle' },
}

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status?.toLowerCase()] ?? { cls: 'bg-slate-100 text-slate-700', icon: 'clock' as IconName }
  return (
    <span className={`pill ${s.cls}`}>
      <Icon name={s.icon} className="h-3.5 w-3.5" strokeWidth={2.5} />
      <span className="capitalize">{status?.replace(/[-_]/g, ' ')}</span>
    </span>
  )
}

const SEVERITY_STYLES: Record<string, string> = {
  urgent: 'bg-rose-100 text-rose-700',
  high: 'bg-orange-100 text-orange-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-sky-100 text-sky-700',
}

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={`pill uppercase ${SEVERITY_STYLES[severity?.toLowerCase()] ?? 'bg-sky-100 text-sky-700'}`}>
      {severity}
    </span>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">{label}</p>
      <div className="mt-1 text-sm font-semibold text-ink">{children}</div>
    </div>
  )
}

export function EmptyState({ icon, text }: { icon: IconName; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="clay-sm mb-3 flex h-12 w-12 items-center justify-center rounded-2xl text-ink-muted">
        <Icon name={icon} className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium text-ink-muted">{text}</p>
    </div>
  )
}

export function Loader({ text = 'Loading...' }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <div className="clay-sm flex h-16 w-16 items-center justify-center rounded-full">
        <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-orange-100 border-t-orange-500" />
      </div>
      <p className="mt-4 font-medium text-ink-soft">{text}</p>
    </div>
  )
}

export function ErrorState({ text }: { text: string }) {
  return (
    <div className="clay flex items-center gap-4 p-5 text-rose-700">
      <div className="clay-sm flex h-11 w-11 items-center justify-center rounded-2xl">
        <Icon name="alert" />
      </div>
      <p className="font-semibold">{text}</p>
    </div>
  )
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
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1).filter(
    (n) => n === 1 || n === totalPages || Math.abs(n - page) <= 1
  )
  return (
    <div className="no-print flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/70 px-5 py-3">
      <p className="text-xs text-ink-soft">
        Showing <b className="text-ink">{from}–{to}</b> of <b className="text-ink">{total}</b> {noun}
      </p>
      {totalPages > 1 && (
        <div className="flex items-center gap-1.5">
          <button onClick={() => setPage(page - 1)} disabled={page === 1} className="clay-btn-ghost btn-icon !h-8 !w-8" title="Previous">
            <Icon name="chevronRight" className="h-4 w-4 rotate-180" />
          </button>
          {pages.map((n, i) => (
            <span key={n} className="flex items-center gap-1.5">
              {i > 0 && n - pages[i - 1]! > 1 && <span className="px-0.5 text-xs text-ink-muted">…</span>}
              <button
                onClick={() => setPage(n)}
                className={`h-8 min-w-8 rounded-[10px] px-2 text-xs font-bold transition ${
                  n === page ? 'clay-btn !rounded-[10px] !p-0 !px-2' : 'text-ink-soft hover:bg-white'
                }`}
              >
                {n}
              </button>
            </span>
          ))}
          <button onClick={() => setPage(page + 1)} disabled={page === totalPages} className="clay-btn-ghost btn-icon !h-8 !w-8" title="Next">
            <Icon name="chevronRight" className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  )
}
