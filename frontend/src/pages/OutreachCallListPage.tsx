import {
  useOutreachCalls,
  useCallStats,
  useFeedbackSchedules,
  useFeedbackCallback,
  useScheduleFeedback,
  useCancelFeedbackSchedule,
  type FeedbackSummary,
} from '../hooks/useOutreachCalls'
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

      <ScheduledCallbacks />

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
                      <div className="flex flex-wrap gap-2">
                        <span className="pill bg-slate-100 text-slate-700">#{call.id}</span>
                        {call.purpose === 'feedback' && (
                          <span className="pill bg-violet-100 text-violet-700">Feedback</span>
                        )}
                      </div>
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
              <div className="mt-5 rounded-2xl bg-rose-50 p-4 text-rose-700">
                <p className="flex items-center gap-3 font-bold">
                  <Icon name="alert" className="h-5 w-5" /> Warning Signs Detected
                </p>
                {selected.structured_summary?.warning_sign_details && (
                  <p className="mt-1 pl-8 text-sm">{selected.structured_summary.warning_sign_details}</p>
                )}
              </div>
            )}

            <FeedbackCallbackPanel key={selected.id} callId={selected.id} />

            {selected.structured_summary && <FeedbackDetails feedback={selected.structured_summary} />}

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

const WORKING_COLOR: Record<string, string> = {
  yes: 'bg-emerald-100 text-emerald-700',
  partly: 'bg-amber-100 text-amber-700',
  no: 'bg-rose-100 text-rose-700',
}

const FOLLOWUP_COLOR: Record<string, string> = {
  resolved: 'bg-emerald-100 text-emerald-700',
  better: 'bg-emerald-100 text-emerald-700',
  same: 'bg-amber-100 text-amber-700',
  worse: 'bg-rose-100 text-rose-700',
  still_open: 'bg-sky-100 text-sky-700',
}

function FeedbackDetails({ feedback }: { feedback: FeedbackSummary }) {
  const medications = feedback.medications || []
  const problems = feedback.problems || []
  const queries = feedback.patient_queries || []
  const followups = feedback.previous_call_followup || []

  return (
    <div className="mt-6 space-y-5">
      <div>
        <p className="mb-3 flex items-center gap-2 font-extrabold text-ink">
          <Icon name="messages" className="h-4 w-4 text-orange-500" /> Patient Feedback
        </p>
        {feedback.summary && <p className="text-sm leading-relaxed text-ink-soft">{feedback.summary}</p>}
        <div className="clay-inset mt-3 grid grid-cols-2 gap-4 rounded-[18px] p-4 md:grid-cols-3">
          <Field label="Condition">
            <span className="capitalize">{feedback.symptom_status || '—'}</span>
          </Field>
          <Field label="Sentiment">
            <span className="capitalize">{feedback.sentiment || '—'}</span>
          </Field>
          <Field label="Outcome">
            <span className="capitalize">{feedback.outcome?.replace(/_/g, ' ') || '—'}</span>
          </Field>
        </div>
        {feedback.disease_feedback && (
          <p className="mt-3 text-sm text-ink-soft">
            <span className="font-bold text-ink">In their words: </span>
            {feedback.disease_feedback}
          </p>
        )}
        {feedback.callback_requested_time && (
          <p className="mt-2 text-sm text-ink-soft">
            <span className="font-bold text-ink">Call back: </span>
            {feedback.callback_requested_time}
          </p>
        )}
      </div>

      {followups.length > 0 && (
        <div>
          <p className="mb-3 flex items-center gap-2 font-extrabold text-ink">
            <Icon name="clock" className="h-4 w-4 text-orange-500" /> Follow-up on Previous Call
            {feedback.previous_call_id && (
              <span className="text-xs font-semibold text-ink-soft">#{feedback.previous_call_id}</span>
            )}
          </p>
          <div className="space-y-2">
            {followups.map((f, i) => (
              <div key={i} className="clay-inset rounded-2xl px-4 py-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-bold text-ink">{f.item}</p>
                  <span className={`pill capitalize ${FOLLOWUP_COLOR[f.status] || 'bg-slate-100 text-slate-700'}`}>
                    {f.status.replace(/_/g, ' ')}
                  </span>
                </div>
                {f.notes && <p className="mt-1 text-ink-soft">{f.notes}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {medications.length > 0 && (
        <div>
          <p className="mb-3 flex items-center gap-2 font-extrabold text-ink">
            <Icon name="pill" className="h-4 w-4 text-orange-500" /> Medicines
          </p>
          <div className="space-y-2">
            {medications.map((m, i) => (
              <div key={i} className="clay-inset rounded-2xl px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold text-ink">{m.name}</p>
                  <div className="flex flex-wrap gap-2">
                    {m.working && m.working !== 'unknown' && (
                      <span className={`pill ${WORKING_COLOR[m.working] || 'bg-slate-100 text-slate-700'}`}>
                        Working: {m.working}
                      </span>
                    )}
                    {m.taking_as_prescribed === false && (
                      <span className="pill bg-amber-100 text-amber-700">Not as prescribed</span>
                    )}
                  </div>
                </div>
                {m.side_effects && <p className="mt-1 text-ink-soft">Side effects: {m.side_effects}</p>}
                {m.missed_doses && <p className="mt-1 text-ink-soft">Missed doses: {m.missed_doses}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {problems.length > 0 && (
        <div>
          <p className="mb-3 flex items-center gap-2 font-extrabold text-ink">
            <Icon name="alert" className="h-4 w-4 text-orange-500" /> Problems Reported
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
            {problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {queries.length > 0 && (
        <div>
          <p className="mb-3 flex items-center gap-2 font-extrabold text-ink">
            <Icon name="hash" className="h-4 w-4 text-orange-500" /> Patient Questions
          </p>
          <div className="space-y-2">
            {queries.map((q, i) => (
              <div key={i} className="clay-inset rounded-2xl px-4 py-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-bold text-ink">{q.question}</p>
                  {q.needs_doctor_followup && (
                    <span className="pill bg-sky-100 text-sky-700">Needs doctor follow-up</span>
                  )}
                </div>
                {q.answer_given && <p className="mt-1 text-ink-soft">Answer: {q.answer_given}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {feedback.appointment_details && (
        <p className="flex items-center gap-2 text-sm text-ink-soft">
          <Icon name="calendar" className="h-4 w-4 text-orange-500" />
          <span className="font-bold text-ink">Appointment:</span> {feedback.appointment_details}
        </p>
      )}
    </div>
  )
}

function apiError(err: any, fallback: string) {
  return err?.response?.data?.detail || fallback
}

// Default for the schedule picker: tomorrow 10:00 local time, in datetime-local format
function defaultScheduleTime() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(10, 0, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function FeedbackCallbackPanel({ callId }: { callId: number }) {
  const { mutate: callNow, isPending: isCalling } = useFeedbackCallback()
  const { mutate: schedule, isPending: isScheduling } = useScheduleFeedback()
  const [showSchedule, setShowSchedule] = useState(false)
  const [when, setWhen] = useState(defaultScheduleTime)
  const [notes, setNotes] = useState('')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const startNow = () => {
    setMessage(null)
    callNow(callId, {
      onSuccess: (call: any) =>
        setMessage({ ok: true, text: `Feedback call #${call.id} started. Its feedback will appear in Call Logs when it ends.` }),
      onError: (err) => setMessage({ ok: false, text: apiError(err, 'Failed to start feedback call') }),
    })
  }

  const saveSchedule = () => {
    setMessage(null)
    schedule(
      { callId, scheduled_at: new Date(when).toISOString(), notes: notes.trim() || undefined },
      {
        onSuccess: () => {
          setShowSchedule(false)
          setNotes('')
          setMessage({ ok: true, text: `Feedback callback scheduled for ${formatDateTime(new Date(when).toISOString())}.` })
        },
        onError: (err) => setMessage({ ok: false, text: apiError(err, 'Failed to schedule callback') }),
      }
    )
  }

  return (
    <div className="clay-inset mt-5 rounded-[18px] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-extrabold text-ink">Feedback Callback</p>
          <p className="text-xs text-ink-soft">Call the patient back to ask about their condition, medicines, problems and questions.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={startNow} disabled={isCalling} className="clay-btn btn-sm">
            <Icon name="phoneCall" className="h-4 w-4" />
            {isCalling ? 'Calling...' : 'Call Now'}
          </button>
          <button onClick={() => setShowSchedule((s) => !s)} className="clay-btn-ghost btn-sm">
            <Icon name="calendar" className="h-4 w-4" /> Schedule
          </button>
        </div>
      </div>

      {showSchedule && (
        <div className="mt-4 grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-end">
          <label className="text-xs font-bold uppercase tracking-wider text-ink-muted">
            Date & time
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="clay-input mt-1 block w-full text-sm font-semibold normal-case tracking-normal text-ink"
            />
          </label>
          <label className="text-xs font-bold uppercase tracking-wider text-ink-muted">
            Note (optional)
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Ask about the new medicine"
              className="clay-input mt-1 block w-full text-sm font-semibold normal-case tracking-normal text-ink"
            />
          </label>
          <button onClick={saveSchedule} disabled={isScheduling || !when} className="clay-btn btn-sm">
            {isScheduling ? 'Saving...' : 'Save'}
          </button>
        </div>
      )}

      {message && (
        <p className={`mt-3 text-sm font-semibold ${message.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{message.text}</p>
      )}
    </div>
  )
}

const SCHEDULE_STATUS_STYLE: Record<string, string> = {
  pending: 'bg-sky-100 text-sky-700',
  dialing: 'bg-amber-100 text-amber-700',
  dialed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-rose-100 text-rose-700',
  cancelled: 'bg-slate-100 text-slate-600',
}

function ScheduledCallbacks() {
  const { data: schedules } = useFeedbackSchedules()
  const { mutate: cancel, isPending: isCancelling } = useCancelFeedbackSchedule()
  const [showAll, setShowAll] = useState(false)

  const upcoming = (schedules || [])
    .filter((s) => s.status === 'pending' || s.status === 'dialing')
    .sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time))
  const past = (schedules || []).filter((s) => s.status !== 'pending' && s.status !== 'dialing')
  const shown = showAll ? [...upcoming, ...past] : upcoming
  if (!schedules?.length) return null

  return (
    <div className="clay mt-6 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-3 pt-4">
        <p className="card-title flex items-center gap-2">
          <Icon name="calendar" className="h-4 w-4 text-orange-500" /> Scheduled Feedback Callbacks
        </p>
        {past.length > 0 && (
          <button onClick={() => setShowAll((s) => !s)} className="clay-btn-ghost btn-sm">
            {showAll ? 'Upcoming only' : `Show history (${past.length})`}
          </button>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="px-5 pb-4 text-sm text-ink-muted">No upcoming callbacks</p>
      ) : (
        <div className="space-y-2 px-4 pb-4">
          {shown.map((s) => (
            <div key={s.id} className="clay-inset flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-ink">
                  {s.patient_name}
                  {s.source_outreach_call_id && (
                    <span className="ml-2 text-xs font-semibold text-ink-soft">from call #{s.source_outreach_call_id}</span>
                  )}
                </p>
                <p className="text-xs text-ink-soft">{formatShortDateTime(s.scheduled_time, true)}</p>
                {s.notes && <p className="mt-0.5 whitespace-pre-wrap text-xs text-ink-muted">{s.notes}</p>}
              </div>
              <div className="flex items-center gap-2">
                <span className={`pill capitalize ${SCHEDULE_STATUS_STYLE[s.status] || 'bg-slate-100 text-slate-600'}`}>
                  {s.status}
                </span>
                {s.status === 'pending' && (
                  <button
                    onClick={() => cancel(s.id)}
                    disabled={isCancelling}
                    className="clay-btn-ghost btn-icon"
                    title="Cancel callback"
                  >
                    <Icon name="x" className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
