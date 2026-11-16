import { useEffect, useMemo, useRef, useState } from 'react'
import { useCalls, useCallPage, useCallbacks, useDialCallback, useFollowUpCall, useUpdateCallback, type Call, type Callback } from '../hooks/useCalls'
import { useAppointments } from '../hooks/useAppointments'
import { useClinicInfo } from '../hooks/useClinic'
import { Icon, type IconName } from '../components/Icon'
import {
  PageHeader,
  Kpi,
  StatusBadge,
  EmptyState,
  Loader,
  ErrorState,
  Avatar,
  Drawer,
  Spinner,
  DirectionLabel,
  friendlyTime,
  formatLength,
  formatDateTime,
  utcDate,
  Pagination,
} from '../components/ui'
import { OutcomeBadge, UrgencyBadge, TranscriptView, printAppointmentSlip, localISODate } from '../components/clinic'
import { toast, errorText } from '../components/toast'

const PAGE_SIZE = 10
type TabKey = 'all' | 'outbound' | 'inbound'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: 'All calls' },
  { key: 'outbound', label: 'Outbound' },
  { key: 'inbound', label: 'Inbound' },
]
const MISSED = ['no-answer', 'no_answer', 'failed', 'busy', 'canceled', 'cancelled']
const OPEN_CB = ['pending', 'calling', 'failed']
const isMissed = (c: Call) => MISSED.includes(c.status)
const byTime = (a: Callback, b: Callback) => a.scheduled_time.localeCompare(b.scheduled_time)
// scheduled_time is naive clinic time
const isDue = (c: Callback) => c.status === 'pending' && new Date(c.scheduled_time).getTime() <= Date.now()

function TypePill({ call, askedCallback }: { call: Call; askedCallback: boolean }) {
  if (call.warning_signs_detected) return <span className="pill bad">Warning signs</span>
  if (isMissed(call)) return <span className="pill warn">Missed</span>
  if (askedCallback) return <span className="pill info">Callback</span>
  return <span className="pill mute">Normal</span>
}

const CB_LABEL: Record<string, { text: string; cls: string; icon: IconName }> = {
  pending: { text: 'Scheduled', cls: 'info', icon: 'calendar' },
  calling: { text: 'Calling now', cls: 'acc', icon: 'phoneCall' },
  completed: { text: 'Called back', cls: 'ok', icon: 'checkCircle' },
  failed: { text: 'Not reached', cls: 'bad', icon: 'phoneMissed' },
  cancelled: { text: 'Cancelled', cls: 'mute', icon: 'xCircle' },
}

function CallbackCell({ callback, returnFor }: { callback?: Callback; returnFor?: Callback }) {
  if (callback) {
    const l = CB_LABEL[callback.status] ?? CB_LABEL.pending!
    return (
      <div>
        <span className={`pill ${l.cls}`}>
          <Icon name={l.icon} className="h-3.5 w-3.5" /> {l.text}
        </span>
        {(callback.status === 'pending' || callback.status === 'calling') && (
          <small className="mt-0.5 block whitespace-nowrap text-ink-muted">{friendlyTime(callback.scheduled_time)}</small>
        )}
      </div>
    )
  }
  if (returnFor)
    return (
      <span className="pill violet">
        <Icon name="phoneCall" className="h-3.5 w-3.5" /> Return call
      </span>
    )
  return <span className="whitespace-nowrap text-[13px] text-ink-muted">Normal call</span>
}

/* ---------------- Scheduled callbacks drawer ---------------- */

function CallbacksDrawer({ open, onClose, callbacks, onViewCall }: { open: boolean; onClose: () => void; callbacks: Callback[]; onViewCall: (id: number) => void }) {
  const update = useUpdateCallback()
  const dial = useDialCallback()
  const [busy, setBusy] = useState<number | null>(null)
  const [filter, setFilter] = useState<'open' | 'due' | 'failed'>('open')
  const openList = callbacks.filter((c) => OPEN_CB.includes(c.status)).sort(byTime)
  const due = openList.filter(isDue)
  const failed = openList.filter((c) => c.status === 'failed')
  const shown = filter === 'due' ? due : filter === 'failed' ? failed : openList

  const setStatus = (cb: Callback, status: 'completed' | 'cancelled') => {
    setBusy(cb.id)
    update.mutate(
      { id: cb.id, status },
      {
        onSuccess: () => (status === 'completed' ? toast.success('Callback marked done', cb.patient_name || cb.phone_number || undefined) : toast.warning('Callback cancelled', cb.patient_name || cb.phone_number || undefined)),
        onError: (err) => toast.error('Could not update callback', errorText(err, 'Please try again.')),
        onSettled: () => setBusy(null),
      },
    )
  }
  const callNow = (cb: Callback) => {
    setBusy(cb.id)
    dial.mutate(cb.id, {
      onSuccess: () => toast.success('Calling now', `The agent is calling ${cb.patient_name || cb.phone_number}`),
      onError: (err) => toast.error('Could not start the call', errorText(err, 'Please try again.')),
      onSettled: () => setBusy(null),
    })
  }

  return (
    <Drawer open={open} onClose={onClose} narrow title="Scheduled callbacks" subtitle="Callers who asked to be called back, staff follow-ups and missed check-in retries.">
      <div className="tabs">
        {(
          [
            ['open', 'Open', openList.length],
            ['due', 'Due now', due.length],
            ['failed', 'Not reached', failed.length],
          ] as const
        ).map(([k, l, n]) => (
          <button key={k} className={`tab ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
            {l} <span className="c">{n}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <EmptyState icon="calendar" text={filter === 'open' ? 'No callbacks scheduled. When a caller asks to be called back, the agent calls them at the agreed time.' : 'Nothing here right now.'} />
      ) : (
        shown.map((cb) => {
          const name = cb.patient_name || cb.phone_number || `Callback ${cb.id}`
          const d = isDue(cb)
          return (
            <div key={cb.id} className="card p-3.5" style={d || cb.status === 'failed' ? { borderColor: 'color-mix(in srgb, var(--bad) 40%, var(--line))' } : undefined}>
              <div className="flex items-start gap-3">
                <Avatar name={name} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap justify-between gap-2">
                    <b className="text-[15px]">{name}</b>
                    <span className={`pill ${cb.status === 'failed' ? 'bad' : cb.attempt_number > 1 ? 'warn' : 'info'}`}>
                      {cb.status === 'failed' ? 'Not reached' : cb.status === 'calling' ? 'Calling' : cb.attempt_number > 1 ? `Attempt ${cb.attempt_number} of ${cb.max_attempts}` : 'Pending'}
                    </span>
                  </div>
                  {cb.patient_name && <small className="text-ink-muted">{cb.phone_number}</small>}
                  <p className="mt-1.5 text-ink-soft">{cb.schedule_type === 'retry' ? 'Retry after missed check-in' : cb.notes || (cb.schedule_type === 'staff' ? 'Follow-up by staff' : 'Asked to be called back')}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] font-bold">
                    <span className={`inline-flex items-center gap-1.5 ${d ? 'text-bad' : ''}`}>
                      <Icon name="clock" className="h-3.5 w-3.5" /> {friendlyTime(cb.scheduled_time)}
                      {d && ' · due now'}
                    </span>
                    {cb.source_call_log_id && (
                      <button className="text-brand hover:underline" onClick={() => onViewCall(cb.source_call_log_id!)}>
                        From call {cb.source_call_log_id}
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-2.5 flex justify-end gap-2 border-t border-line-soft pt-2.5">
                {cb.status === 'pending' && (
                  <button className="btn sm p" disabled={busy === cb.id} onClick={() => callNow(cb)}>
                    {busy === cb.id && dial.isPending ? <Spinner /> : <Icon name="phone" className="h-3.5 w-3.5" />} Call now
                  </button>
                )}
                <button className="btn sm" disabled={busy === cb.id || cb.status === 'calling'} onClick={() => setStatus(cb, 'completed')}>
                  Mark done
                </button>
                <button className="btn sm d" disabled={busy === cb.id || cb.status === 'calling'} onClick={() => setStatus(cb, 'cancelled')}>
                  Cancel
                </button>
              </div>
            </div>
          )
        })
      )}
    </Drawer>
  )
}

function toLocalInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function FollowUp({ call, callback }: { call: Call; callback?: Callback }) {
  const followUp = useFollowUpCall()
  const [when, setWhen] = useState('')
  const [reason, setReason] = useState('')
  const [mode, setMode] = useState<'schedule' | 'now' | null>(null)
  const open = callback && (callback.status === 'pending' || callback.status === 'calling')
  const calling = callback?.status === 'calling'
  const who = call.patient_name || call.phone_number

  const submit = (now: boolean) => {
    setMode(now ? 'now' : 'schedule')
    followUp.mutate(
      { callId: call.id, call_now: now, scheduled_time: now ? undefined : when, reason: reason.trim() || undefined },
      {
        onSuccess: (cb) => {
          if (now) toast.success('Calling now', `The agent is calling ${who}`)
          else toast.success('Callback scheduled', `${who} · ${formatDateTime(cb.scheduled_time)}`)
          setWhen('')
          setReason('')
        },
        onError: (err) => toast.error('Could not schedule the callback', errorText(err, 'Please try again.')),
        onSettled: () => setMode(null),
      },
    )
  }

  if (!call.phone_number && !call.patient_id) return <p className="text-ink-muted">No phone number on this call, so it can't be called back.</p>
  return (
    <div>
      <div className="lbl mb-2">Follow-up</div>
      {callback && (
        <div className="note mb-2.5 flex flex-wrap items-center justify-between gap-2" style={{ background: 'var(--info-bg)' }}>
          <span>
            <b>{callback.schedule_type === 'staff' ? 'Follow-up' : 'Callback requested'}</b> for {formatDateTime(callback.scheduled_time)}
            {callback.notes ? ` · ${callback.notes}` : ''}
          </span>
          <StatusBadge status={callback.status} />
        </div>
      )}
      <div className="grid gap-2.5 sm:grid-cols-[1fr_1.4fr]">
        <input type="datetime-local" className="field" value={when} min={toLocalInput(new Date())} onChange={(e) => setWhen(e.target.value)} aria-label="Call back at" />
        <input className="field" value={reason} maxLength={500} placeholder="Note for the agent (optional)" onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="mt-2.5 flex gap-2">
        <button className="btn p" disabled={!when || followUp.isPending || calling} onClick={() => submit(false)}>
          {mode === 'schedule' ? <Spinner /> : <Icon name="calendar" className="h-4 w-4" />} {open ? 'Reschedule callback' : 'Schedule callback'}
        </button>
        <button className="btn" disabled={followUp.isPending || calling} onClick={() => submit(true)}>
          {mode === 'now' ? <Spinner /> : <Icon name="phone" className="h-4 w-4" />} Call now
        </button>
      </div>
    </div>
  )
}

/* ---------------- Page ---------------- */

type Filters = { from: string; to: string; name: string; mrn: string; phone: string }
const NO_FILTERS: Filters = { from: '', to: '', name: '', mrn: '', phone: '' }

/** "YYYY-MM-DDTHH:MM" local (datetime-local) to an ISO string the backend understands. */
const toIso = (v: string) => (v ? new Date(v).toISOString() : undefined)

/** Filter button + popover: date/time range, patient name, MRN and phone. */
function FilterButton({ value, onApply }: { value: Filters; onApply: (f: Filters) => void }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Filters>(value)
  const ref = useRef<HTMLDivElement>(null)
  const active = Object.values(value).filter(Boolean).length

  useEffect(() => {
    if (!open) return
    setDraft(value)
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open, value])

  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }))
  const badRange = draft.from && draft.to && new Date(draft.from) >= new Date(draft.to)

  return (
    <div ref={ref} className="relative">
      <button className={`btn ${active ? '!border-brand !text-brand' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon name="filter" className="h-4 w-4" /> Filter
        {active > 0 && <span className="rounded-full bg-brand px-1.5 text-[11px] text-white">{active}</span>}
      </button>
      {open && (
        <form
          className="card absolute right-0 top-[44px] z-40 w-[360px] max-w-[calc(100vw-32px)] space-y-3 p-4 shadow-lift"
          onSubmit={(e) => {
            e.preventDefault()
            if (badRange) return
            onApply(draft)
            setOpen(false)
          }}
        >
          <div className="flex items-center justify-between">
            <b>Filter calls</b>
            <button type="button" className="text-[12.5px] font-bold text-brand" onClick={() => setDraft(NO_FILTERS)}>
              Clear all
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <label>
              <span className="lbl mb-1 block">From</span>
              <input id="cf-from" type="datetime-local" className="field !h-9 !px-2 text-[13px]" value={draft.from} onChange={set('from')} />
            </label>
            <label>
              <span className="lbl mb-1 block">To</span>
              <input id="cf-to" type="datetime-local" className="field !h-9 !px-2 text-[13px]" value={draft.to} onChange={set('to')} />
            </label>
          </div>
          {badRange && <p className="text-[12px] font-bold text-bad">“To” must be after “From”.</p>}
          <label className="block">
            <span className="lbl mb-1 block">Patient name</span>
            <input id="cf-name" className="field !h-9" placeholder="e.g. Sruthi" value={draft.name} onChange={set('name')} />
          </label>
          <div className="grid grid-cols-2 gap-2.5">
            <label>
              <span className="lbl mb-1 block">MRN</span>
              <input id="cf-mrn" className="field !h-9" placeholder="e.g. PT001" value={draft.mrn} onChange={set('mrn')} />
            </label>
            <label>
              <span className="lbl mb-1 block">Phone</span>
              <input id="cf-phone" className="field !h-9" placeholder="Any part of it" value={draft.phone} onChange={set('phone')} inputMode="tel" />
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn sm" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn sm p" disabled={!!badRange}>
              Apply filters
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

export function CallsPage() {
  const [tab, setTab] = useState<TabKey>('all')
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [cbOpen, setCbOpen] = useState(() => {
    const w = window as unknown as { __ppOpenCallbacks?: boolean }
    const v = !!w.__ppOpenCallbacks
    w.__ppOpenCallbacks = false
    return v
  })
  const [page, setPage] = useState(1)

  useEffect(() => {
    const open = () => {
      ;(window as unknown as { __ppOpenCallbacks?: boolean }).__ppOpenCallbacks = false
      setCbOpen(true)
    }
    window.addEventListener('open-callbacks', open)
    return () => window.removeEventListener('open-callbacks', open)
  }, [])

  // The table: one page at a time, filtered on the server
  const search = {
    page,
    page_size: PAGE_SIZE,
    direction: tab === 'all' ? undefined : tab,
    date_from: toIso(filters.from),
    date_to: toIso(filters.to),
    name: filters.name.trim() || undefined,
    mrn: filters.mrn.trim() || undefined,
    phone: filters.phone.trim() || undefined,
  }
  const { data: result, isLoading, isFetching, error, refetch } = useCallPage(search)
  // KPI tiles and the call drawer still use the shared recent-calls list
  const { data: calls } = useCalls()
  const { data: appointments } = useAppointments()
  const { data: callbacks } = useCallbacks()
  const { data: info } = useClinicInfo()

  const cbByCall = useMemo(() => new Map((callbacks || []).filter((c) => c.source_call_log_id).map((c) => [c.source_call_log_id!, c] as const)), [callbacks])
  const cbByReturn = useMemo(() => new Map((callbacks || []).filter((c) => c.call_log_id).map((c) => [c.call_log_id!, c] as const)), [callbacks])

  if (isLoading && !result) return <Loader text="Loading calls…" />
  if (error && !result) return <ErrorState text="Could not load calls" onRetry={() => refetch()} />

  const items = result?.items || []
  const total = result?.total || 0
  const counts = result?.counts || { all: 0, outbound: 0, inbound: 0 }
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const paged = {
    page,
    setPage,
    totalPages,
    total,
    from: total ? (page - 1) * PAGE_SIZE + 1 : 0,
    to: Math.min(page * PAGE_SIZE, total),
  }

  const all = calls || []
  const sel = items.find((c) => c.id === selectedId) || all.find((c) => c.id === selectedId)
  const selAppts = (appointments || []).filter((a) => sel && a.call_log_id === sel.id)
  const openCbs = (callbacks || []).filter((c) => OPEN_CB.includes(c.status))
  const dueCount = openCbs.filter(isDue).length

  const completed = all.filter((c) => c.status === 'completed').length
  const booked = all.filter((c) => c.outcome === 'booked').length
  const warnings = all.filter((c) => c.warning_signs_detected).length
  const missed = all.filter(isMissed).length
  const rate = all.length ? Math.round((completed / all.length) * 100) : 0
  const series = (pred: (c: Call) => boolean) =>
    Array.from({ length: 7 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (6 - i))
      const k = localISODate(d)
      return all.filter((c) => pred(c) && localISODate(utcDate(c.started_at || c.created_at)) === k).length
    })

  const chips: [keyof Filters, string][] = [
    ['from', filters.from && `From ${friendlyTime(filters.from)}`],
    ['to', filters.to && `To ${friendlyTime(filters.to)}`],
    ['name', filters.name && `Name: ${filters.name}`],
    ['mrn', filters.mrn && `MRN: ${filters.mrn}`],
    ['phone', filters.phone && `Phone: ${filters.phone}`],
  ].filter(([, v]) => v) as [keyof Filters, string][]
  const applyFilters = (f: Filters) => {
    setFilters(f)
    setPage(1)
  }

  return (
    <div>
      <PageHeader title="Call Logs" />

      <div className="grid g4 mb-3.5">
        <Kpi label="Total calls" value={all.length} hint={`${missed} missed`} icon="phone" tone="a" trend={series(() => true)} />
        <Kpi label="Completed" value={completed} hint={`${rate}% completion rate`} dir="up" icon="checkCircle" tone="ok" trend={series((c) => c.status === 'completed')} />
        <Kpi label="Led to booking" value={booked} hint="Appointments booked on a call" icon="calendar" tone="violet" trend={series((c) => c.outcome === 'booked')} />
        <Kpi label="Warning signs" value={warnings} valueTone={warnings ? 'bad' : undefined} hint="Escalated to the care team" icon="alert" tone="bad" trend={series((c) => c.warning_signs_detected)} />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
        <div className="tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`tab ${tab === t.key ? 'on' : ''}`}
              onClick={() => {
                setTab(t.key)
                setPage(1)
              }}
            >
              {t.label}
              <span className="c">{counts[t.key]}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn p" onClick={() => setCbOpen(true)}>
            <Icon name="calendar" className="h-4 w-4" /> Scheduled callbacks
            <span className="rounded-full bg-white/25 px-1.5 text-[11px]">{openCbs.length}</span>
            {dueCount > 0 && <span className="dot" style={{ background: '#ffb4b8' }} title={`${dueCount} due now`} />}
          </button>
          <FilterButton value={filters} onApply={applyFilters} />
        </div>
      </div>

      {chips.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {chips.map(([k, label]) => (
            <span key={k} className="chip">
              {label}
              <button className="text-ink-muted hover:text-ink" title="Remove filter" onClick={() => applyFilters({ ...filters, [k]: '' })}>
                <Icon name="x" className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
          <button className="text-[12.5px] font-bold text-brand" onClick={() => applyFilters(NO_FILTERS)}>
            Clear all
          </button>
        </div>
      )}

      <div className="card relative">
        {isFetching && <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden rounded-t-xl"><div className="skel h-full w-full" /></div>}
        <table className="t">
          <thead>
            <tr>
              <th>Call</th>
              <th>Patient</th>
              <th className="hidden lg:table-cell">Direction</th>
              <th>Time</th>
              <th className="hidden 2xl:table-cell">Length</th>
              <th>Type</th>
              <th className="hidden xl:table-cell">Callback</th>
              <th className="hidden 2xl:table-cell">Summary</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((c) => {
              const name = c.patient_name || c.phone_number || 'Unknown caller'
              return (
                <tr key={c.id} className="rowbtn" onClick={() => setSelectedId(c.id)}>
                  <td className="text-ink-muted">{c.id}</td>
                  <td>
                    <div className="who">
                      <Avatar name={name} />
                      <div className="min-w-0">
                        <b className="truncate text-brand">{name}</b>
                        <small>{c.patient_name ? c.phone_number : c.direction === 'inbound' ? 'New caller' : ''}</small>
                      </div>
                    </div>
                  </td>
                  <td className="hidden lg:table-cell">
                    <DirectionLabel direction={c.direction} />
                  </td>
                  <td className="whitespace-nowrap text-ink-soft">{friendlyTime(c.started_at || c.created_at, true)}</td>
                  <td className="hidden 2xl:table-cell">{formatLength(c.duration_seconds)}</td>
                  <td>
                    <TypePill call={c} askedCallback={cbByCall.has(c.id)} />
                  </td>
                  <td className="hidden xl:table-cell">
                    <CallbackCell callback={cbByCall.get(c.id)} returnFor={cbByReturn.get(c.id)} />
                  </td>
                  <td className="hidden max-w-[360px] text-[13px] text-ink-soft 2xl:table-cell">
                    <span className="line-clamp-2">{c.summary || <span className="text-ink-muted">No summary yet</span>}</span>
                  </td>
                  <td className="text-right">
                    <button className="btn sm">View</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {items.length === 0 && <EmptyState icon="phone" text={chips.length ? 'No calls match these filters.' : 'No calls yet.'} />}
        <Pagination paged={paged} noun="calls" />
      </div>

      <CallbacksDrawer
        open={cbOpen}
        onClose={() => setCbOpen(false)}
        callbacks={callbacks || []}
        onViewCall={(id) => {
          setCbOpen(false)
          setSelectedId(id)
        }}
      />

      <Drawer
        open={!!sel}
        onClose={() => setSelectedId(null)}
        title={sel ? `Call ${sel.id}` : ''}
        subtitle={sel ? [sel.patient_name, sel.phone_number].filter(Boolean).join(' · ') : ''}
      >
        {sel && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <DirectionLabel direction={sel.direction} />
              <StatusBadge status={sel.status} />
              <TypePill call={sel} askedCallback={cbByCall.has(sel.id)} />
              {sel.csat_score != null && (
                <span className="pill warn">
                  <Icon name="star" className="h-3.5 w-3.5" /> {sel.csat_score}/5
                </span>
              )}
            </div>
            <div className="kv">
              <div>
                <div className="lbl">Started</div>
                <b>{friendlyTime(sel.started_at || sel.created_at, true)}</b>
              </div>
              <div>
                <div className="lbl">Length</div>
                <b>{formatLength(sel.duration_seconds)}</b>
              </div>
              <div>
                <div className="lbl">Adherence</div>
                <b className="capitalize">{sel.medication_adherence_reported || '—'}</b>
              </div>
              <div>
                <div className="lbl">Outcome</div>
                <b>
                  <OutcomeBadge outcome={sel.outcome} />
                </b>
              </div>
              <div>
                <div className="lbl">Urgency</div>
                <b>
                  <UrgencyBadge urgency={sel.urgency} />
                </b>
              </div>
              <div>
                <div className="lbl">Call SID</div>
                <b className="mono break-all">{sel.call_sid || '—'}</b>
              </div>
            </div>
            {sel.warning_signs_detected && (
              <div className="alertbox">
                <Icon name="alert" className="h-[18px] w-[18px]" /> Warning signs detected · escalation raised automatically
              </div>
            )}
            {sel.summary && (
              <div>
                <div className="lbl mb-1.5">Summary</div>
                <p className="note">{sel.summary}</p>
              </div>
            )}
            <FollowUp key={sel.id} call={sel} callback={cbByCall.get(sel.id)} />
            {cbByReturn.get(sel.id) && (
              <div className="note" style={{ background: 'var(--violet-bg)', color: 'var(--violet)', fontWeight: 700 }}>
                Return call for a callback requested in call {cbByReturn.get(sel.id)!.source_call_log_id}
              </div>
            )}
            {selAppts.length > 0 && (
              <div>
                <div className="lbl mb-1.5">Appointment</div>
                {selAppts.map((a) => (
                  <div key={a.id} className="okbox flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {a.doctor_name}
                      {a.doctor_specialty ? ` · ${a.doctor_specialty}` : ''} · {a.start_at ? formatDateTime(a.start_at) : 'To be scheduled'}
                    </span>
                    {a.start_at && (
                      <button className="btn sm" onClick={() => printAppointmentSlip(a)}>
                        Print slip
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div>
              <div className="lbl mb-2">Conversation</div>
              {sel.transcript ? <TranscriptView transcript={sel.transcript} agentName={info?.agent_name || 'Agent'} /> : <p className="text-ink-muted">No conversation recorded for this call.</p>}
            </div>
          </>
        )}
      </Drawer>
    </div>
  )
}
