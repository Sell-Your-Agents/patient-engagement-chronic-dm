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
  const todayFormatted = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date())

  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <button
          onClick={() => window.dispatchEvent(new Event('open-sidebar'))}
          className="m-btn btn-icon no-print mt-1 shrink-0 lg:hidden !h-9 !w-9 !p-0"
          title="Open menu"
        >
          <Icon name="menu" className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          {back ? (
            <Link
              to={back.to}
              className="mb-1 inline-flex items-center gap-1.5 text-xs font-bold text-[#56646f] transition hover:text-[#0b6f6a]"
            >
              <Icon name="arrowLeft" className="h-3.5 w-3.5" /> {back.label}
            </Link>
          ) : (
            <div className="text-[13px] font-semibold text-[#56646f]">{todayFormatted}</div>
          )}
          <h1 className="truncate text-[26px] font-extrabold leading-tight tracking-tight text-[#14212e] dark:text-white md:text-[28px]">
            {title}
          </h1>
          {subtitle && <p className="mt-1 text-xs text-[#56646f] dark:text-slate-300">{subtitle}</p>}
        </div>
      </div>
      <div className="no-print flex shrink-0 items-center gap-3">
        {actions && <div className="flex items-center gap-2">{actions}</div>}
        <UserMenu />
      </div>
    </header>
  )
}

export type Tint = 'peach' | 'mint' | 'lavender' | 'coral' | 'amber' | 'sky' | 'rose' | 'teal'

export function StatCard({
  label,
  value,
  subtext,
  subtextColor,
}: {
  label: string
  value: ReactNode
  subtext?: string
  subtextColor?: string
  // Kept for backward compatibility
  icon?: IconName
  tint?: Tint
}) {
  return (
    <div className="m-card">
      <div className="m-lbl dark:text-slate-400">{label}</div>
      <div className="mt-1.5 text-[28px] font-extrabold leading-none tracking-tight text-[#14212e] dark:text-white md:text-[30px]">
        {value}
      </div>
      {subtext && (
        <div className={`mt-1.5 text-[13px] ${subtextColor || 'text-[#56646f] dark:text-slate-300'}`}>
          {subtext}
        </div>
      )}
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
    <div className={`m-card ${className}`}>
      {(title || right) && (
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
          {title && <div className="text-[16px] font-extrabold text-[#14212e] dark:text-white">{title}</div>}
          {right}
        </div>
      )}
      {children}
    </div>
  )
}

const STATUS_STYLES: Record<string, { cls: string; icon: IconName }> = {
  completed: { cls: 'm-pill-ok', icon: 'checkCircle' },
  resolved: { cls: 'm-pill-ok', icon: 'checkCircle' },
  confirmed: { cls: 'm-pill-ok', icon: 'checkCircle' },
  active: { cls: 'm-pill-ok', icon: 'checkCircle' },
  stable: { cls: 'm-pill-ok', icon: 'checkCircle' },
  'in-progress': { cls: 'm-pill-info', icon: 'activity' },
  in_progress: { cls: 'm-pill-info', icon: 'activity' },
  initiated: { cls: 'm-pill-info', icon: 'phone' },
  booked: { cls: 'm-pill-info', icon: 'calendar' },
  requested: { cls: 'm-pill-warn', icon: 'clock' },
  acknowledged: { cls: 'm-pill-warn', icon: 'clock' },
  review: { cls: 'm-pill-warn', icon: 'clock' },
  'needs review': { cls: 'm-pill-warn', icon: 'clock' },
  'no-answer': { cls: 'm-pill-warn', icon: 'clock' },
  no_answer: { cls: 'm-pill-warn', icon: 'phoneMissed' },
  pending: { cls: 'm-pill-info', icon: 'clock' },
  open: { cls: 'm-pill-bad', icon: 'alert' },
  escalated: { cls: 'm-pill-bad', icon: 'alert' },
  failed: { cls: 'm-pill-bad', icon: 'xCircle' },
  busy: { cls: 'm-pill-bad', icon: 'xCircle' },
  cancelled: { cls: 'm-pill-mute', icon: 'xCircle' },
  inactive: { cls: 'm-pill-mute', icon: 'xCircle' },
  discharged: { cls: 'm-pill-mute', icon: 'xCircle' },
}

export function StatusBadge({ status }: { status: string }) {
  const norm = status?.toLowerCase()
  const s = STATUS_STYLES[norm] ?? { cls: 'm-pill-mute', icon: 'clock' as IconName }
  return (
    <span className={`m-pill ${s.cls}`}>
      <Icon name={s.icon} className="h-3 w-3" strokeWidth={2.5} />
      <span className="capitalize">{status?.replace(/[-_]/g, ' ')}</span>
    </span>
  )
}

const SEVERITY_STYLES: Record<string, string> = {
  urgent: 'm-pill-bad',
  high: 'm-pill-warn',
  medium: 'm-pill-info',
  low: 'm-pill-ok',
}

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={`m-pill uppercase ${SEVERITY_STYLES[severity?.toLowerCase()] ?? 'm-pill-info'}`}>
      {severity}
    </span>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="m-lbl dark:text-slate-400">{label}</div>
      <div className="mt-1 text-sm font-semibold text-[#14212e] dark:text-white">{children}</div>
    </div>
  )
}

export function EmptyState({ icon, text }: { icon: IconName; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#eef2f5] text-[#8fa1b3]">
        <Icon name={icon} className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium text-[#56646f]">{text}</p>
    </div>
  )
}

export function Loader({ text = 'Loading...' }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm border border-[#dbe3ea]">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#dff3ea] border-t-[#0f8f87]" />
      </div>
      <p className="mt-4 text-xs font-bold uppercase tracking-wider text-[#56646f]">{text}</p>
    </div>
  )
}

export function ErrorState({ text }: { text: string }) {
  return (
    <div className="m-card flex items-center gap-4 border-rose-200 bg-rose-50/50 p-5 text-rose-800">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-700">
        <Icon name="alert" />
      </div>
      <p className="text-sm font-bold">{text}</p>
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

export interface PagedResult<T> {
  items: T[]
  pageItems: T[]
  page: number
  totalPages: number
  totalItems: number
  setPage: (n: number) => void
  pageSize: number
}

export function paginate<T>(items: T[], page: number, setPage: (n: number) => void, pageSize: number): PagedResult<T> {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const currentPage = Math.min(Math.max(1, page), totalPages)
  const start = (currentPage - 1) * pageSize
  const paged = items.slice(start, start + pageSize)
  return {
    items: paged,
    pageItems: paged,
    page: currentPage,
    totalPages,
    totalItems: items.length,
    setPage,
    pageSize,
  }
}

export function Pagination({
  page,
  totalPages,
  setPage,
  totalItems,
  paged,
  noun,
}: {
  page?: number
  totalPages?: number
  setPage?: (n: number) => void
  totalItems?: number
  paged?: { page: number; totalPages: number; setPage: (n: number) => void; totalItems: number }
  noun?: string
}) {
  const curPage = paged ? paged.page : page ?? 1
  const pages = paged ? paged.totalPages : totalPages ?? 1
  const doSetPage = paged ? paged.setPage : setPage ?? (() => {})
  const total = paged ? paged.totalItems : totalItems

  if (pages <= 1) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#dbe3ea] bg-white px-5 py-3">
      {total !== undefined && (
        <span className="text-xs font-semibold text-[#56646f]">
          Showing page {curPage} of {pages} ({total} {noun || 'total'})
        </span>
      )}
      <div className="flex items-center gap-1.5 ml-auto">
        <button
          onClick={() => doSetPage(curPage - 1)}
          disabled={curPage <= 1}
          className="m-btn !min-h-[32px] !py-1 !px-2.5 !text-xs disabled:opacity-40"
        >
          Previous
        </button>
        <span className="px-2 text-xs font-bold text-[#14212e]">
          {curPage} / {pages}
        </span>
        <button
          onClick={() => doSetPage(curPage + 1)}
          disabled={curPage >= pages}
          className="m-btn !min-h-[32px] !py-1 !px-2.5 !text-xs disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  )
}
