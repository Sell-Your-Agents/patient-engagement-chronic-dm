import { useState } from 'react'
import { useClinicCalls, useClinicAppointments, useClinicInfo } from '../../hooks/useClinic'
import { Icon } from '../../components/Icon'
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
} from '../../components/ui'
import { OutcomeBadge, UrgencyBadge, TranscriptView, printAppointmentSlip } from '../../components/clinic'

const PAGE_SIZE = 6

export function ClinicCallsPage() {
  const { data: calls, isLoading, error } = useClinicCalls()
  const { data: appointments } = useClinicAppointments()
  const { data: info } = useClinicInfo()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [page, setPage] = useState(1)

  if (isLoading) return <Loader text="Loading callback logs..." />
  if (error) return <ErrorState text="Error loading callback logs" />

  const list = calls || []
  const paged = paginate(list, page, setPage, PAGE_SIZE)
  const pageCalls = paged.pageItems
  const selected = list.find((c) => c.id === selectedId)
  const selectedAppointments = (appointments || []).filter((a) => selected && a.clinic_call_id === selected.id)

  const connected = list.filter((c) => c.status === 'completed').length
  const booked = list.filter((c) => c.outcome === 'booked').length
  const unanswered = list.filter((c) => ['no-answer', 'busy', 'failed'].includes(c.status)).length

  return (
    <div>
      <PageHeader title="Callback Logs" subtitle="Every callback the agent made, with what the caller said and what was booked." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Callbacks" value={list.length} icon="phoneCall" tint="sky" />
        <StatCard label="Connected" value={connected} icon="checkCircle" tint="mint" />
        <StatCard label="Led to Booking" value={booked} icon="calendar" tint="lavender" />
        <StatCard label="Not Answered" value={unanswered} icon="phoneMissed" tint="coral" />
      </div>

      <Panel
        className="mt-6"
        title="All Callbacks"
      >
        <div>
          <table className="clay-table">
            <thead>
              <tr>
                <th>Caller</th>
                <th className="col-md">Date & Time</th>
                <th className="col-2xl">Duration</th>
                <th className="col-lg">Status</th>
                <th>Outcome</th>
                <th className="col-xl">Urgency</th>
                <th className="col-xl">Reason</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {pageCalls.map((call) => (
                <tr key={call.id}>
                  <td>
                    <p className="font-bold text-ink">{call.patient_name || call.phone_number}</p>
                    {call.patient_name && <p className="text-xs font-semibold text-ink-soft">{call.phone_number}</p>}
                  </td>
                  <td className="col-md whitespace-nowrap text-ink-soft">{formatShortDateTime(call.started_at || call.created_at, true)}</td>
                  <td className="col-2xl font-bold">{call.duration_seconds != null ? `${call.duration_seconds}s` : '—'}</td>
                  <td className="col-lg">
                    <StatusBadge status={call.status} />
                  </td>
                  <td>
                    <OutcomeBadge outcome={call.outcome} />
                  </td>
                  <td className="col-xl">
                    <UrgencyBadge urgency={call.urgency} />
                  </td>
                  <td className="col-xl max-w-[220px] text-ink-soft">
                    <p className="truncate">{call.reason || '—'}</p>
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
          {pageCalls.length === 0 && <EmptyState icon="phoneCall" text="No callbacks yet" />}
        </div>
        <Pagination paged={paged} noun="callbacks" />
      </Panel>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/25 backdrop-blur-sm" onClick={() => setSelectedId(null)} />
          <div className="clay clay-scroll relative max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-extrabold text-ink">Callback #{selected.id}</h3>
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
              <Field label="Status">
                <StatusBadge status={selected.status} />
              </Field>
              <Field label="Outcome">
                <OutcomeBadge outcome={selected.outcome} />
              </Field>
              <Field label="Urgency">
                <UrgencyBadge urgency={selected.urgency} />
              </Field>
              <Field label="Started">{formatUtcDateTime(selected.started_at)}</Field>
              <Field label="Duration">{selected.duration_seconds != null ? `${selected.duration_seconds}s` : '—'}</Field>
              <Field label="Reason">{selected.reason || '—'}</Field>
            </div>

            {selected.summary && (
              <div className="mt-5">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-muted">Summary</p>
                <p className="text-sm leading-relaxed text-ink-soft">{selected.summary}</p>
              </div>
            )}

            {selectedAppointments.length > 0 && (
              <div className="mt-5 space-y-2.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">Appointment Booked</p>
                {selectedAppointments.map((a) => (
                  <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-emerald-50 px-4 py-3">
                    <div>
                      <p className="text-sm font-bold text-emerald-800">
                        {a.doctor_name} · {a.doctor_specialty}
                      </p>
                      <p className="text-xs font-semibold text-emerald-700">{formatDateTime(a.start_at)}</p>
                    </div>
                    <button onClick={() => printAppointmentSlip(a)} className="clay-btn-ghost btn-sm">
                      <Icon name="printer" className="h-3.5 w-3.5" /> Print slip
                    </button>
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
