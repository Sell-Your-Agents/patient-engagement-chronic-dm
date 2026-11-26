import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useDashboard, type DashboardData } from '../hooks/useKpis'
import { INTENT_LABELS, LANGUAGE_LABELS, useCallPage, callerName } from '../hooks/useCalls'
import { useClinicInfo } from '../hooks/useClinic'
import { PageHeader, Kpi, Panel, Loader, ErrorState, EmptyState, Avatar, formatTime, friendlyTime, formatLength } from '../components/ui'
import { useAppointments } from '../hooks/useAppointments'
import { AppointmentStatusBadge, IntentBadge, BookingBadge, localISODate } from '../components/clinic'

export function DashboardPage() {
  const { data, isLoading, error, refetch } = useDashboard(7)
  const { data: info } = useClinicInfo()

  if (isLoading) return <Loader text="Loading dashboard…" variant="dashboard" />
  if (error || !data) return <ErrorState text="Could not load the dashboard" onRetry={() => refetch()} />

  const pendingNote =
    info?.appointment_integration === 'none' ? 'No clinic booking system connected: staff confirm every request' : 'Pending until staff confirm'

  return (
    <div>
      <PageHeader title="Dashboard" />

      <div className="grid g4 mb-3.5">
        <Kpi
          label="Calls today"
          value={data.calls_today}
          hint={data.live_calls ? `${data.live_calls} in progress now` : `${data.calls_period} in the last ${data.days} days`}
          icon="phoneIncoming"
          tone="a"
          to="/calls"
        />
        <Kpi
          label="Needs staff follow-up"
          value={data.pending_follow_ups}
          hint={data.urgent_follow_ups ? `${data.urgent_follow_ups} urgent: call now` : 'People to call back'}
          icon={data.urgent_follow_ups ? 'alert' : 'phoneCall'}
          tone={data.urgent_follow_ups ? 'bad' : 'warn'}
          valueTone={data.urgent_follow_ups ? 'bad' : undefined}
          to="/follow-ups"
        />
        <Kpi label="Pending appointments" value={data.pending_appointments} hint={pendingNote} icon="calendar" tone="violet" to="/appointments" />
        <Kpi label="Upcoming visits" value={data.confirmed_upcoming} hint="Confirmed by staff, from today" icon="checkCircle" tone="ok" to="/appointments" />
      </div>

      {/* Row 2: today's schedule | calls per day */}
      <div className="grid g2 mb-3.5">
        <TodaySchedule />
        <Panel
          title={`Calls per day · last ${data.days} days`}
          subtitle={`${data.calls_period} calls · ${data.appointment_requests_period} appointment requests (${data.request_rate}% of calls)`}
        >
          <CallsChart data={data} />
        </Panel>
      </div>

      {/* Row 3: why people called | the last five calls */}
      <div className="grid g2">
        <Panel title="Patient Inquiries" subtitle={`Why people called · last ${data.days} days`}>
          <ShareBars counts={data.intents} labels={INTENT_LABELS} empty="No calls yet" />
          <div className="mx-4 mb-4 border-t border-line-soft pt-3">
            <div className="lbl mb-2">Languages</div>
            {Object.keys(data.languages).length === 0 ? (
              <span className="text-[13px] text-ink-muted">No calls yet</span>
            ) : (
              <div className="flex flex-wrap gap-2">
                {Object.entries(data.languages)
                  .sort((a, b) => b[1] - a[1])
                  .map(([code, n]) => {
                    const total = Object.values(data.languages).reduce((x, y) => x + y, 0)
                    return (
                      <span key={code} className="chip">
                        {LANGUAGE_LABELS[code] || code} <b>{n}</b>
                        <span className="text-ink-muted">· {Math.round((n / total) * 100)}%</span>
                      </span>
                    )
                  })}
              </div>
            )}
          </div>
        </Panel>
        <RecentCalls />
      </div>
    </div>
  )
}

/** Today's appointments by time (pending requests with a slot, confirmed and completed); scrolls when long. */
function TodaySchedule() {
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  const { data, isLoading } = useAppointments({ date_from: localISODate(today), date_to: localISODate(tomorrow) })
  const items = (data || [])
    .filter((a) => a.start_at && a.status !== 'cancelled')
    .sort((x, y) => (x.start_at! < y.start_at! ? -1 : 1))
  const doctors = new Set(items.map((a) => a.doctor_id)).size
  const dot: Record<string, string> = { completed: 'var(--ok)', confirmed: 'var(--accent)', pending: 'var(--warn)' }

  return (
    <Panel
      className="flex min-w-0 flex-col"
      title="Today's schedule"
      subtitle={items.length ? `${items.length} appointment${items.length === 1 ? '' : 's'} across ${doctors} doctor${doctors === 1 ? '' : 's'}` : 'No appointments today'}
      right={
        <Link to="/appointments" className="btn sm">
          All
        </Link>
      }
    >
      {isLoading ? null : items.length === 0 ? (
        <EmptyState icon="calendar" text="Nothing booked for today yet." />
      ) : (
        <div className="max-h-[300px] overflow-y-auto px-4 pb-4">
          {items.map((a) => (
            <div key={a.id} className="flex gap-3">
              <span className="w-[72px] shrink-0 pt-0.5 text-right text-[13px] font-bold tabular-nums">{formatTime(a.start_at)}</span>
              <div className="relative flex w-3 shrink-0 justify-center">
                <span className="absolute inset-y-0 w-px bg-line" />
                <span className="relative mt-1.5 h-2.5 w-2.5 rounded-full" style={{ background: dot[a.status] || 'var(--mute)' }} />
              </div>
              <div className="min-w-0 flex-1 pb-4">
                <b className="block truncate text-[14px]">{a.patient_saved_name || a.patient_name}</b>
                <small className="block truncate text-[12.5px] text-ink-muted" title={[a.doctor_name, a.reason].filter(Boolean).join(' · ')}>
                  {[a.doctor_name, a.reason].filter(Boolean).join(' · ')}
                </small>
                <span className="mt-1 inline-block">
                  <AppointmentStatusBadge status={a.status} />
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

/** The last five finished calls; click one to open it, or All for Call Records. */
function RecentCalls() {
  const navigate = useNavigate()
  const { data, isLoading } = useCallPage({ page: 1, page_size: 5, finished_only: true })
  const calls = data?.items || []
  return (
    <Panel
      className="flex min-w-0 flex-col"
      title="Latest calls"
      subtitle="The most recent calls to the clinic"
      right={
        <Link to="/calls" className="btn sm">
          All
        </Link>
      }
    >
      {isLoading ? null : calls.length === 0 ? (
        <EmptyState icon="phone" text="No calls yet." />
      ) : (
        <div className="px-2 pb-3">
          {calls.map((c) => {
            const name = callerName(c) || 'Unknown caller'
            return (
              <button
                key={c.id}
                type="button"
                className="recent-call"
                onClick={() => navigate({ to: '/calls/$id', params: { id: String(c.id) }, search: { from: 'dashboard' } })}
                title="Open this call: transcript and recording"
              >
                <Avatar name={name} size={32} />
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-[13.5px]">{name}</b>
                  <small className="block truncate text-[12px] text-ink-muted">
                    {c.call_ref} · {friendlyTime(c.started_at || c.created_at, true)} · {formatLength(c.duration_seconds)}
                    {c.language ? ` · ${LANGUAGE_LABELS[c.language] || c.language}` : ''}
                  </small>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <IntentBadge intent={c.intent} />
                  {c.booking_status && c.booking_status !== 'not_applicable' && <BookingBadge status={c.booking_status} />}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </Panel>
  )
}

/** One series (calls per day) on one axis; the tooltip adds that day's appointment requests. */
function CallsChart({ data }: { data: DashboardData }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...data.trend.map((d) => d.calls))
  const ticks = max <= 4 ? Array.from({ length: max + 1 }, (_, i) => i) : [0, Math.round(max / 2), max]
  const label = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const weekday = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })
  const active = hover !== null ? data.trend[hover] : null

  if (data.calls_period === 0) return <EmptyState icon="phone" text="No calls in this period yet. Try a test call from Call the Agent." />

  return (
    <div className="px-4 pb-4">
      <div className="mb-2 h-5 text-[12.5px] text-ink-soft" aria-live="polite">
        {active ? (
          <>
            <b className="text-ink">{weekday(active.date)} {label(active.date)}</b> · {active.calls} call{active.calls === 1 ? '' : 's'} · {active.requests} appointment request
            {active.requests === 1 ? '' : 's'}
          </>
        ) : (
          'Hover a day for details'
        )}
      </div>
      <div className="relative flex h-[180px] gap-2">
        <div className="flex w-6 flex-col-reverse justify-between text-right text-[11px] text-ink-muted">
          {ticks.map((t) => (
            <span key={t} className="leading-none">
              {t}
            </span>
          ))}
        </div>
        <div className="relative flex flex-1 items-end gap-[2px] border-b border-line" role="img" aria-label={`Calls per day for the last ${data.days} days`}>
          {ticks.slice(1).map((t) => (
            <div key={t} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-line-soft" style={{ bottom: `${(t / max) * 100}%` }} />
          ))}
          {data.trend.map((d, i) => (
            <button
              key={d.date}
              type="button"
              className="relative flex h-full flex-1 items-end justify-center focus:outline-none"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              aria-label={`${label(d.date)}: ${d.calls} calls, ${d.requests} appointment requests`}
            >
              <span
                className="block w-full max-w-[26px] rounded-t-[4px] transition-opacity"
                style={{
                  height: d.calls ? `${(d.calls / max) * 100}%` : 0,
                  minHeight: d.calls ? 3 : 0,
                  background: 'var(--accent)',
                  opacity: hover === null || hover === i ? 1 : 0.45,
                }}
              />
            </button>
          ))}
        </div>
      </div>
      <div className="ml-8 mt-1.5 flex gap-[2px] text-[10.5px] text-ink-muted">
        {data.trend.map((d, i) => (
          <span key={d.date} className="flex-1 text-center">
            {i === 0 || i === data.trend.length - 1 || i === Math.floor(data.trend.length / 2) ? label(d.date) : ''}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Share of calls per category: label and count in ink, one accent bar for magnitude. */
function ShareBars({ counts, labels, empty }: { counts: Record<string, number>; labels: Record<string, string>; empty: string }) {
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1])
  const total = rows.reduce((sum, [, n]) => sum + n, 0)
  if (!total) return <div className="px-4 pb-5 text-[13px] text-ink-muted">{empty}</div>
  return (
    <div className="space-y-3 px-4 pb-4">
      {rows.map(([key, n]) => (
        <div key={key} title={`${labels[key] || key}: ${n} of ${total} calls`}>
          <div className="mb-1 flex justify-between gap-2 text-[13px]">
            <span className="truncate text-ink-soft">{labels[key] || key.replace(/_/g, ' ')}</span>
            <b>
              {n} <span className="font-normal text-ink-muted">· {Math.round((n / total) * 100)}%</span>
            </b>
          </div>
          <span className="bar">
            <i style={{ width: `${(n / total) * 100}%` }} />
          </span>
        </div>
      ))}
    </div>
  )
}
