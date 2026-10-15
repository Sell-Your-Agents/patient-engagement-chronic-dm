import { useOutreachCalls, useCallStats } from '../hooks/useOutreachCalls'
import { usePatients } from '../hooks/usePatients'
import { useState } from 'react'
import { Icon } from '../components/Icon'
import {
  PageHeader,
  StatCard,
  StatusBadge,
  Field,
  EmptyState,
  Loader,
  ErrorState,
  formatDateTime,
  formatShortDateTime,
  callDuration,
  paginate,
  Pagination,
} from '../components/ui'

const PAGE_SIZE = 6

const ADHERENCE_COLOR: Record<string, string> = {
  excellent: 'text-emerald-600',
  good: 'text-emerald-600',
  fair: 'text-amber-600',
  poor: 'text-rose-600',
}

export function OutreachCallListPage() {
  const { data: calls, isLoading, error } = useOutreachCalls()
  const { data: stats } = useCallStats()
  const { data: patients } = usePatients(0, 100)
  const [selectedCallId, setSelectedCallId] = useState<number | null>(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [showFilter, setShowFilter] = useState(false)
  const [page, setPage] = useState(1)

  if (isLoading) return <Loader text="Loading calls..." />
  if (error) return <ErrorState text="Error loading calls" />

  const patientById = new Map(patients?.map((p) => [p.id, p]) || [])
  const statuses = Array.from(new Set(calls?.map((c) => c.status) || []))
  const filtered = (calls || []).filter((c) => statusFilter === 'all' || c.status === statusFilter)
  const paged = paginate(filtered, page, setPage, PAGE_SIZE)
  const pageCalls = paged.pageItems
  const selected = calls?.find((c) => c.id === selectedCallId)
  const selectedPatient = selected ? patientById.get(selected.patient_id) : undefined

  return (
    <div>
      <PageHeader title="Call Logs" subtitle="Review full conversation records and details of outreach calls." />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Calls" value={stats?.total_calls || 0} icon="phone" tint="mint" />
        <StatCard label="Completed" value={stats?.completed_calls || 0} icon="checkCircle" tint="lavender" />
        <StatCard label="Completion Rate" value={`${stats?.completion_rate || 0}%`} icon="trending" tint="amber" />
        <StatCard
          label="Avg CSAT"
          value={stats?.average_csat ? stats.average_csat.toFixed(1) : 'N/A'}
          icon="star"
          tint="coral"
        />
      </div>

      {/* Toolbar */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <div className="relative">
          <button onClick={() => setShowFilter((s) => !s)} className="clay-btn-ghost text-sm">
            <Icon name="filter" className="h-4 w-4 text-orange-500" />
            {statusFilter === 'all' ? 'Filter Calls' : `Status: ${statusFilter}`}
          </button>
          {showFilter && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowFilter(false)} />
              <div className="clay absolute left-0 z-20 mt-3 w-56 !rounded-[18px] p-2">
                {['all', ...statuses].map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setStatusFilter(s)
                      setPage(1)
                      setShowFilter(false)
                    }}
                    className={`w-full rounded-xl px-3 py-2 text-left text-sm font-semibold capitalize transition hover:bg-orange-50 ${
                      statusFilter === s ? 'bg-orange-50 text-orange-600' : 'text-ink'
                    }`}
                  >
                    {s === 'all' ? 'All statuses' : s.replace(/[-_]/g, ' ')}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Call table */}
      <div className="clay mt-6 overflow-hidden">
        <div>
          <table className="clay-table w-full">
            <thead>
              <tr>
                <th>Patient</th>
                <th className="col-2xl">Call</th>
                <th className="col-md">Date & Time</th>
                <th className="col-lg">Duration</th>
                <th>Status</th>
                <th className="col-xl">Adherence</th>
                <th className="col-xl">Flags</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {pageCalls.map((call) => {
                const patient = patientById.get(call.patient_id)
                return (
                  <tr key={call.id}>
                    <td>
                      <p className="font-bold text-ink">
                        {patient ? `${patient.first_name} ${patient.last_name}` : `Patient #${call.patient_id}`}
                      </p>
                      {patient && <p className="text-xs font-semibold text-ink-soft">{patient.phone_number}</p>}
                    </td>
                    <td className="col-2xl">
                      <span className="pill bg-slate-100 text-slate-700">#{call.id}</span>
                    </td>
                    <td className="col-md whitespace-nowrap text-ink-soft">{formatShortDateTime(call.started_at)}</td>
                    <td className="col-lg font-bold">{callDuration(call.started_at, call.ended_at)}</td>
                    <td>
                      <StatusBadge status={call.status} />
                    </td>
                    <td
                      className={`col-xl font-bold capitalize ${
                        ADHERENCE_COLOR[call.medication_adherence_reported || ''] || 'text-ink-muted'
                      }`}
                    >
                      {call.medication_adherence_reported || '—'}
                    </td>
                    <td className="col-xl">
                      <div className="flex flex-wrap gap-2">
                        {call.warning_signs_detected && (
                          <span className="pill bg-rose-100 text-rose-700">
                            <Icon name="alert" className="h-3.5 w-3.5" /> Warning Signs
                          </span>
                        )}
                        {call.csat_score && (
                          <span className="pill bg-amber-100 text-amber-700">
                            <Icon name="star" className="h-3.5 w-3.5" /> CSAT {call.csat_score}/5
                          </span>
                        )}
                        {!call.warning_signs_detected && !call.csat_score && <span className="text-ink-muted">—</span>}
                      </div>
                    </td>
                    <td>
                      <button onClick={() => setSelectedCallId(call.id)} className="clay-btn-ghost btn-sm">
                        View <Icon name="chevronRight" className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {pageCalls.length === 0 && <EmptyState icon="phone" text="No calls found" />}
        </div>
        <Pagination paged={paged} noun="calls" />
      </div>

      {/* Call detail modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/25 backdrop-blur-sm" onClick={() => setSelectedCallId(null)} />
          <div className="clay clay-scroll relative max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-extrabold text-ink">Call #{selected.id} Details</h3>
                <p className="mt-1 text-ink-soft">
                  {selectedPatient
                    ? `${selectedPatient.first_name} ${selectedPatient.last_name} · ${selectedPatient.phone_number}`
                    : `Patient #${selected.patient_id}`}
                </p>
              </div>
              <button onClick={() => setSelectedCallId(null)} className="clay-btn-ghost btn-icon" title="Close">
                <Icon name="x" className="h-4 w-4" />
              </button>
            </div>

            <div className="clay-inset mt-5 grid grid-cols-2 gap-4 rounded-[18px] p-4 md:grid-cols-3">
              <Field label="Status">
                <StatusBadge status={selected.status} />
              </Field>
              <Field label="Started">{formatDateTime(selected.started_at)}</Field>
              <Field label="Duration">{callDuration(selected.started_at, selected.ended_at)}</Field>
              <Field label="Medication Adherence">
                <span className="capitalize">{selected.medication_adherence_reported || '—'}</span>
              </Field>
              <Field label="Patient Satisfaction">
                {selected.csat_score ? (
                  <span className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Icon
                        key={star}
                        name="star"
                        className={`h-4 w-4 ${star <= selected.csat_score! ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`}
                      />
                    ))}
                  </span>
                ) : (
                  '—'
                )}
              </Field>
              <Field label="Call SID">
                <span className="break-all font-mono text-xs">{selected.call_sid || '—'}</span>
              </Field>
            </div>

            {selected.warning_signs_detected && (
              <div className="mt-5 flex items-center gap-3 rounded-2xl bg-rose-50 p-4 font-bold text-rose-700">
                <Icon name="alert" className="h-5 w-5" /> Warning Signs Detected
              </div>
            )}

            <div className="mt-6">
              <p className="mb-3 flex items-center gap-2 font-extrabold text-ink">
                <Icon name="file" className="h-4 w-4 text-orange-500" /> Transcript
              </p>
              {selected.transcript ? (
                <div className="clay-inset clay-scroll max-h-72 overflow-y-auto whitespace-pre-wrap rounded-[18px] p-4 text-sm leading-relaxed text-ink-soft">
                  {selected.transcript}
                </div>
              ) : (
                <p className="text-sm text-ink-muted">No transcript available</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
