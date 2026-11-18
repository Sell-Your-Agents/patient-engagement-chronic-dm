import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useDashboard, type DashboardData } from '../hooks/useKpis'
import { INTENT_LABELS, LANGUAGE_LABELS } from '../hooks/useCalls'
import { useClinicInfo } from '../hooks/useClinic'
import { PageHeader, Kpi, Panel, Loader, ErrorState, EmptyState, formatTime } from '../components/ui'
import { useAppointments } from '../hooks/useAppointments'
import { AppointmentStatusBadge, localISODate } from '../components/clinic'
import { Icon } from '../components/Icon'

export function DashboardPage() {
  const { data, isLoading, error, refetch } = useDashboard(7)
  const { data: info } = useClinicInfo()

  if (isLoading) return <Loader text="Loading dashboard…" variant="dashboard" />
  if (error || !data) return <ErrorState text="Could not load the dashboard" onRetry={() => refetch()} />

  const pendingNote =
    info?.appointment_integration === 'none' ? 'No clinic booking system connected: staff confirm every request' : 'Waiting for staff to confirm'

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
        <Kpi label="Pending confirmation" value={data.pending_appointments} hint={pendingNote} icon="calendar" tone="violet" to="/appointments" />
        <Kpi label="Confirmed by Staff" value={data.confirmed_upcoming} hint="Upcoming visits" icon="checkCircle" tone="ok" to="/appointments" />
      </div>

      {/* Two cards side by side: calls over time | why and in which language */}
      <div className="grid g2 mb-3.5">
        <Panel
          title={`Calls per day · last ${data.days} days`}
          subtitle={`${data.calls_period} calls · ${data.appointment_requests_period} appointment requests (${data.request_rate}% of calls)`}
        >
          <CallsChart data={data} />
        </Panel>
        <Panel title="Why people called" subtitle={`Caller intent and language · last ${data.days} days`}>
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
      </div>

      {/* Today's appointments beside the agent */}
      <div className="grid gap-[14px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <TodaySchedule />
        <AgentCard />
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
                <b className="block truncate text-[14px]">{a.patient_name}</b>
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

/** The AI agent itself: what it can do on a call, and whether each ability is switched on. */
function AgentCard() {
  const { data: info } = useClinicInfo()
  const agent = info?.agent_name || 'Agent'
  const langs = (info?.languages || []).map((l) => l.name)
  const abilities: { title: string; text: string; on: boolean }[] = [
    { title: 'Answers every call', text: `In ${langs.join(', ') || 'English'}; greets saved patients in their own language`, on: true },
    { title: 'Records appointment requests', text: info?.appointment_integration === 'none' ? 'Doctor, time and reason; staff confirm on Appointments' : 'Books straight into the clinic system', on: true },
    { title: 'Answers doctor and timing questions', text: 'Only from the Doctors and Clinic Knowledge pages, never made up', on: true },
    { title: 'Takes callback requests', text: 'Missed calls and "please call me back" go to Follow-ups', on: true },
    { title: 'Passes on questions it cannot answer', text: 'Saved as "Question not answered" for staff to call back', on: true },
    // { title: 'Connects callers to the front desk', text: info?.human_transfer ? 'Hold music, then rings the front desk' : 'Off: set a front-desk number to turn it on; until then it takes a message', on: !!info?.human_transfer },
    { title: 'Handles emergencies', text: 'Tells the caller to call 108 and adds an urgent follow-up', on: true },
    { title: 'Remembers earlier calls', text: 'Knows what the same number asked last time', on: true },
  ]
  return (
    <Panel
      title={`${agent} · AI calling agent`}
      subtitle={`What ${agent} can do on a call`}
      right={
        <Link to="/call-agent" className="btn sm p">
          <Icon name="phone" className="h-3.5 w-3.5" /> Test call
        </Link>
      }
    >
      <div className="grid gap-2 px-4 pb-4 sm:grid-cols-2">
        {abilities.map((ab) => (
          <div key={ab.title} className={`flex min-w-0 items-start gap-2.5 rounded-[10px] border border-line-soft p-2.5 ${ab.on ? '' : 'opacity-60'}`}>
            <span className={`ico ${ab.on ? 'ok' : 'mute'} !h-6 !w-6 shrink-0`}>
              <Icon name={ab.on ? 'check' : 'x'} className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0">
              <b className="block text-[13px] leading-snug">{ab.title}</b>
              <small className="block text-[12px] leading-snug text-ink-muted">{ab.text}</small>
            </div>
          </div>
        ))}
      </div>
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
