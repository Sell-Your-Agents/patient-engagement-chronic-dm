import { useState } from 'react'
import { useCalls, type CallDirection } from '../hooks/useCalls'
import { useAppointments } from '../hooks/useAppointments'
import { useClinicInfo } from '../hooks/useClinic'
import { Icon } from '../components/Icon'
import {
  PageHeader,
  StatCard,
  Panel,
  StatusBadge,
  Field,
  EmptyState,
  Loader,
  ErrorState,
  formatDateTime,
  formatUtcDateTime,
  formatShortDateTime,
  paginate,
  Pagination,
} from '../components/ui'
import { OutcomeBadge, UrgencyBadge, TranscriptView, printAppointmentSlip } from '../components/clinic'

const PAGE_SIZE = 6

const DIRECTIONS: { key: CallDirection | ''; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'outbound', label: 'Outbound' },
  { key: 'inbound', label: 'Inbound' },
]

const ADHERENCE_COLOR: Record<string, string> = {
  excellent: 'text-emerald-600',
  good: 'text-emerald-600',
  fair: 'text-amber-600',
  poor: 'text-rose-600',
}

function DirectionPill({ direction }: { direction: CallDirection }) {
  return direction === 'inbound' ? (
    <span className="pill bg-sky-100 text-sky-700">
      <Icon name="messages" className="h-3.5 w-3.5" /> Inbound
    </span>
  ) : (
    <span className="pill bg-orange-100 text-orange-700">
      <Icon name="phoneCall" className="h-3.5 w-3.5" /> Outbound
    </span>
  )
}

export function CallsPage() {
  const [direction, setDirection] = useState<CallDirection | ''>('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [page, setPage] = useState(1)

  const { data: calls, isLoading, error } = useCalls(direction ? { direction } : {})
  const { data: appointments } = useAppointments()
  const { data: info } = useClinicInfo()

  if (isLoading) return <Loader text="Loading calls..." />
  if (error) return <ErrorState text="Error loading calls" />

  const all = calls || []
  const statuses = Array.from(new Set(all.map((c) => c.status)))
  const list = all.filter((c) => !statusFilter || c.status === statusFilter)
  const paged = paginate(list, page, setPage, PAGE_SIZE)
  const selected = all.find((c) => c.id === selectedId)
  const selectedAppointments = (appointments || []).filter((a) => selected && a.call_log_id === selected.id)

  const completed = all.filter((c) => c.status === 'completed').length
  const booked = all.filter((c) => c.outcome === 'booked').length
  const warnings = all.filter((c) => c.warning_signs_detected).length

  return (
    <div>
      <PageHeader
        title="Call Logs"
        subtitle="Every call the agent made or answered, with the full conversation and what came of it."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Calls" value={all.length} icon="phone" tint="sky" />
        <StatCard label="Completed" value={completed} icon="checkCircle" tint="mint" />
        <StatCard label="Led to Booking" value={booked} icon="calendar" tint="lavender" />
        <StatCard label="Warning Signs" value={warnings} icon="alert" tint="coral" />
      </div>

      {/* Filters */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="clay-sm flex gap-1 rounded-2xl p-1">
          {DIRECTIONS.map((d) => (
            <button
              key={d.key}
              onClick={() => {
                setDirection(d.key)
                setStatusFilter('')
                setPage(1)
              }}
              className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition ${
                direction === d.key ? 'bg-orange-500 text-white shadow' : 'text-ink-soft hover:text-ink'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value)
            setPage(1)
          }}
          className="clay-input !w-auto !py-2 capitalize"
        >
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s.replace(/[-_]/g, ' ')}
            </option>
          ))}
        </select>
      </div>

      <Panel className="mt-6" title="Calls">
        <div>
          <table className="clay-table">
            <thead>
              <tr>
                <th>Caller</th>
                <th className="col-lg">Direction</th>
                <th className="col-md">Date & Time</th>
                <th className="col-2xl">Duration</th>
                <th>Status</th>
                <th className="col-xl">Outcome</th>
                <th className="col-xl">Flags</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {paged.pageItems.map((call) => (
                <tr key={call.id}>
                  <td>
                    <p className="font-bold text-ink">{call.patient_name || call.phone_number || `Call #${call.id}`}</p>
                    {call.patient_name && <p className="text-xs font-semibold text-ink-soft">{call.phone_number}</p>}
                  </td>
                  <td className="col-lg">
                    <DirectionPill direction={call.direction} />
                  </td>
                  <td className="col-md whitespace-nowrap text-ink-soft">
                    {formatShortDateTime(call.started_at || call.created_at, true)}
                  </td>
                  <td className="col-2xl font-bold">{call.duration_seconds != null ? `${call.duration_seconds}s` : '—'}</td>
                  <td>
                    <StatusBadge status={call.status} />
                  </td>
                  <td className="col-xl">
                    {call.outcome ? <OutcomeBadge outcome={call.outcome} /> : <span className="text-ink-muted">—</span>}
                  </td>
                  <td className="col-xl">
                    <div className="flex flex-wrap gap-2">
                      {call.warning_signs_detected && (
                        <span className="pill bg-rose-100 text-rose-700">
                          <Icon name="alert" className="h-3.5 w-3.5" /> Warning Signs
                        </span>
                      )}
                      {call.urgency && <UrgencyBadge urgency={call.urgency} />}
                      {call.csat_score && (
                        <span className="pill bg-amber-100 text-amber-700">
                          <Icon name="star" className="h-3.5 w-3.5" /> {call.csat_score}/5
                        </span>
                      )}
                      {!call.warning_signs_detected && !call.urgency && !call.csat_score && (
                        <span className="text-ink-muted">—</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <button onClick={() => setSelectedId(call.id)} className="clay-btn-ghost btn-sm">
                      View <Icon name="chevronRight" className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {paged.pageItems.length === 0 && <EmptyState icon="phone" text="No calls found" />}
        </div>
        <Pagination paged={paged} noun="calls" />
      </Panel>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/25 backdrop-blur-sm" onClick={() => setSelectedId(null)} />
          <div className="clay clay-scroll relative max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-extrabold text-ink">Call #{selected.id}</h3>
                <p className="mt-1 text-sm text-ink-soft">
                  {selected.patient_name ? `${selected.patient_name} · ` : ''}
                  {selected.phone_number}
                </p>
              </div>
              <button onClick={() => setSelectedId(null)} className="clay-btn-ghost btn-icon" title="Close">
                <Icon name="x" className="h-4 w-4" />
              </button>
            </div>

            <div className="clay-inset mt-5 grid grid-cols-2 gap-4 rounded-[18px] p-4 md:grid-cols-3">
              <Field label="Direction">
                <DirectionPill direction={selected.direction} />
              </Field>
              <Field label="Status">
                <StatusBadge status={selected.status} />
              </Field>
              <Field label="Started">{formatUtcDateTime(selected.started_at)}</Field>
              <Field label="Duration">{selected.duration_seconds != null ? `${selected.duration_seconds}s` : '—'}</Field>
              {selected.outcome && (
                <Field label="Outcome">
                  <OutcomeBadge outcome={selected.outcome} />
                </Field>
              )}
              {selected.urgency && (
                <Field label="Urgency">
                  <UrgencyBadge urgency={selected.urgency} />
                </Field>
              )}
              {selected.direction === 'outbound' && (
                <Field label="Medication Adherence">
                  <span className={`capitalize ${ADHERENCE_COLOR[selected.medication_adherence_reported || ''] || ''}`}>
                    {selected.medication_adherence_reported || '—'}
                  </span>
                </Field>
              )}
              {selected.csat_score != null && (
                <Field label="Patient Satisfaction">
                  <span className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Icon
                        key={star}
                        name="star"
                        className={`h-4 w-4 ${star <= selected.csat_score! ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`}
                      />
                    ))}
                  </span>
                </Field>
              )}
              <Field label="Reason">{selected.reason || '—'}</Field>
              <Field label="Call SID">
                <span className="break-all font-mono text-xs">{selected.call_sid || '—'}</span>
              </Field>
            </div>

            {selected.warning_signs_detected && (
              <div className="mt-5 flex items-center gap-3 rounded-2xl bg-rose-50 p-4 font-bold text-rose-700">
                <Icon name="alert" className="h-5 w-5" /> Warning Signs Detected
              </div>
            )}

            {selected.summary && (
              <div className="mt-5">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-muted">Summary</p>
                <p className="text-sm leading-relaxed text-ink-soft">{selected.summary}</p>
              </div>
            )}

            {selectedAppointments.length > 0 && (
              <div className="mt-5 space-y-2.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">Appointment</p>
                {selectedAppointments.map((a) => (
                  <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-emerald-50 px-4 py-3">
                    <div>
                      <p className="text-sm font-bold text-emerald-800">
                        {a.doctor_name}
                        {a.doctor_specialty ? ` · ${a.doctor_specialty}` : ''}
                      </p>
                      <p className="text-xs font-semibold text-emerald-700">
                        {a.start_at ? formatDateTime(a.start_at) : 'To be scheduled'}
                      </p>
                    </div>
                    {a.start_at && (
                      <button onClick={() => printAppointmentSlip(a)} className="clay-btn-ghost btn-sm">
                        <Icon name="printer" className="h-3.5 w-3.5" /> Print slip
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="mt-6">
              <p className="mb-3 flex items-center gap-2 font-extrabold text-ink">
                <Icon name="messages" className="h-4 w-4 text-orange-500" /> Conversation
              </p>
              {selected.transcript ? (
                <div className="clay-inset clay-scroll max-h-96 overflow-y-auto rounded-[18px] p-4">
                  <TranscriptView transcript={selected.transcript} agentName={info?.agent_name || 'Agent'} />
                </div>
              ) : (
                <p className="text-sm text-ink-muted">No conversation recorded for this call.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
