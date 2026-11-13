import { useState } from 'react'
import { Link, useParams, useNavigate } from '@tanstack/react-router'
import { useInitiateCall } from '../hooks/usePatients'
import { useCallbacks, useFollowUpCall, type Call } from '../hooks/useCalls'
import { useAppointments } from '../hooks/useAppointments'
import { useClinicInfo } from '../hooks/useClinic'
import { usePatientRoster, careTone } from '../hooks/usePatientRoster'
import { Icon } from '../components/Icon'
import {
  PageHeader,
  Panel,
  Loader,
  ErrorState,
  EmptyState,
  Avatar,
  Spinner,
  StatusBadge,
  SeverityBadge,
  DirectionLabel,
  Modal,
  Drawer,
  friendlyTime,
  formatLength,
  formatDateTime,
  paginate,
  Pagination,
} from '../components/ui'
import { OutcomeBadge, UrgencyBadge, TranscriptView } from '../components/clinic'
import { PatientFormModal } from '../components/PatientForm'
import { toast, errorText } from '../components/toast'

const LANG: Record<string, string> = { en: 'English', hi: 'Hindi', te: 'Telugu', ta: 'Tamil', kn: 'Kannada', ml: 'Malayalam' }
const MISSED = ['no-answer', 'no_answer', 'failed', 'busy']

function intervalLabel(days: number, minutes?: number | null) {
  if (minutes) return `Every ${minutes} min`
  if (days % 7 === 0) return days === 7 ? 'Every week' : `Every ${days / 7} weeks`
  return days === 1 ? 'Every day' : `Every ${days} days`
}

function toLocalInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function CallType({ c }: { c: Call }) {
  if (c.warning_signs_detected) return <span className="pill bad">Warning signs</span>
  if (MISSED.includes(c.status)) return <span className="pill warn">Missed</span>
  return <span className="pill mute">Normal</span>
}

export function PatientDetailPage() {
  const navigate = useNavigate()
  const { id } = useParams({ strict: false }) as { id?: string }
  const patientId = Number(id)
  const { rows, isLoading, error, refetch } = usePatientRoster()
  const { data: callbacks } = useCallbacks()
  const { data: appointments } = useAppointments({ patient_id: patientId })
  const { data: info } = useClinicInfo()
  const { mutate: initiateCall, isPending } = useInitiateCall()
  const followUp = useFollowUpCall()
  const [page, setPage] = useState(1)
  const [scheduling, setScheduling] = useState(false)
  const [editing, setEditing] = useState(false)
  const [openCall, setOpenCall] = useState<number | null>(null)
  const [when, setWhen] = useState('')
  const [note, setNote] = useState('')

  if (isLoading) return <Loader text="Loading patient…" variant="detail" />
  const row = rows.find((r) => r.patient.id === patientId)
  if (error || !row) return <ErrorState text="Could not load this patient" onRetry={() => refetch()} />

  const { patient, name, plans, primaryPlan, calls, lastCall, openEscalations, status } = row
  const lastSummary = calls.find((c) => c.summary)
  const nextCallback = (callbacks || [])
    .filter((c) => c.patient_id === patientId && (c.status === 'pending' || c.status === 'calling'))
    .sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time))[0]
  const nextVisit = (appointments || [])
    .filter((a) => a.start_at && new Date(a.start_at).getTime() > Date.now() && a.status !== 'cancelled')
    .sort((a, b) => a.start_at!.localeCompare(b.start_at!))[0]
  const paged = paginate(calls, page, setPage, 6)
  const warnings = calls.filter((c) => c.warning_signs_detected).length
  const selected = calls.find((c) => c.id === openCall)
  const selectedAppts = (appointments || []).filter((a) => selected && a.call_log_id === selected.id)

  const callNow = () =>
    initiateCall(
      { patient_id: patientId },
      {
        onSuccess: () => toast.success('Calling now', `The agent is calling ${name}`),
        onError: (err) => toast.error('Could not start the call', errorText(err, 'Please try again.')),
      },
    )

  const schedule = () => {
    if (!lastCall || !when) return
    followUp.mutate(
      { callId: lastCall.id, scheduled_time: when, reason: note.trim() || undefined },
      {
        onSuccess: (cb) => {
          toast.success('Callback scheduled', `${name} · ${formatDateTime(cb.scheduled_time)}`)
          setScheduling(false)
          setWhen('')
          setNote('')
        },
        onError: (err) => toast.error('Could not schedule the callback', errorText(err, 'Please try again.')),
      },
    )
  }

  return (
    <div>
      <PageHeader title="Patient dashboard" back={{ to: '/patients', label: 'All patients' }} />

      {/* Identity + actions */}
      <div className="card mb-3.5 flex flex-wrap items-center gap-[18px] px-5 py-[18px]">
        <Avatar name={name} size={64} />
        <div className="min-w-[200px] flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-2xl font-black">{name}</h2>
            <span className={`pill ${careTone(status)} dotted`}>{status}</span>
            {warnings > 0 && <span className="pill bad">{warnings} warning call{warnings === 1 ? '' : 's'}</span>}
          </div>
          <p className="mt-1 text-[15px] text-ink-soft">
            {patient.mrn} · {patient.phone_number} · {LANG[patient.preferred_language] || patient.preferred_language.toUpperCase()}
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <button className="btn" onClick={() => setEditing(true)}>
            <Icon name="edit" className="h-4 w-4" /> Edit
          </button>
          <button className="btn" disabled={!lastCall} title={lastCall ? 'Schedule a callback' : 'Available after the first call'} onClick={() => setScheduling(true)}>
            <Icon name="calendar" className="h-4 w-4" /> Schedule callback
          </button>
          <Link to="/appointments" className="btn">
            Book visit
          </Link>
          <button className="btn p" disabled={isPending} onClick={callNow}>
            {isPending ? <Spinner /> : <Icon name="phone" className="h-4 w-4" />} Call now
          </button>
        </div>
      </div>

      {/* Left half: doctor, disease, care plan. Right half: next steps */}
      <div className="mb-3.5 grid gap-3.5 lg:grid-cols-2">
        <div className="grid gap-3.5 sm:grid-cols-3">
          <div className="card px-4 py-4">
            <div className="lbl">Consulting doctor</div>
            {primaryPlan?.assigned_physician_name ? (
              <>
                <div className="mt-2.5">
                  <Avatar name={primaryPlan.assigned_physician_name} size={34} />
                </div>
                <b className="mt-2 block leading-snug">{primaryPlan.assigned_physician_name}</b>
                <small className="text-ink-muted">Assigned physician</small>
              </>
            ) : (
              <b className="mt-2.5 block text-ink-muted">Not assigned</b>
            )}
          </div>
          <div className="card px-4 py-4">
            <div className="lbl">Disease</div>
            <b className="mt-2.5 block text-[17px] font-black leading-snug">{primaryPlan?.condition || 'No care plan'}</b>
            {primaryPlan && <small className="mt-1 block capitalize text-ink-muted">Severity: {primaryPlan.severity || '—'}</small>}
            {plans.length > 1 && <small className="block text-ink-muted">+{plans.length - 1} more condition{plans.length > 2 ? 's' : ''}</small>}
          </div>
          <div className="card px-4 py-4">
            <div className="lbl">Care plan</div>
            <b className="mt-2.5 block text-[17px] font-black leading-snug">
              {primaryPlan ? intervalLabel(primaryPlan.followup_interval_days, primaryPlan.followup_interval_minutes) : '—'}
            </b>
            <small className="mt-1 block text-ink-muted">Next: {primaryPlan ? friendlyTime(primaryPlan.next_due_date, true) : '—'}</small>
            <small className="block text-ink-muted">Last: {lastCall ? friendlyTime(lastCall.started_at || lastCall.created_at, true) : 'No calls yet'}</small>
          </div>
        </div>

        <Panel
          title="Next steps"
          right={
            <span className={`pill ${openEscalations.length ? 'bad' : 'ok'}`}>
              {openEscalations.length} open escalation{openEscalations.length === 1 ? '' : 's'}
            </span>
          }
        >
          <div className="flagrow">
            <span className="flex items-center gap-2.5 text-ink-soft">
              <Icon name="phoneCall" className="h-4 w-4 text-brand" /> Next callback
            </span>
            <b className="text-right">{nextCallback ? friendlyTime(nextCallback.scheduled_time) : 'None scheduled'}</b>
          </div>
          <div className="flagrow">
            <span className="flex items-center gap-2.5 text-ink-soft">
              <Icon name="clock" className="h-4 w-4 text-brand" /> Next check-in
            </span>
            <b className="text-right">{primaryPlan ? friendlyTime(primaryPlan.next_due_date, true) : '—'}</b>
          </div>
          <div className="flagrow">
            <span className="flex items-center gap-2.5 text-ink-soft">
              <Icon name="calendar" className="h-4 w-4 text-brand" /> Next consultation
            </span>
            <b className="text-right">{nextVisit ? `${friendlyTime(nextVisit.start_at)} · ${nextVisit.doctor_name}` : 'None booked'}</b>
          </div>
          {openEscalations.slice(0, 3).map((e) => (
            <div key={e.id} className="flagrow cursor-pointer hover:bg-brand-50" onClick={() => navigate({ to: '/escalations/$id', params: { id: String(e.id) } })}>
              <span className="min-w-0 truncate">{e.reason}</span>
              <SeverityBadge severity={e.severity} />
            </div>
          ))}
        </Panel>
      </div>

      {lastSummary && (
        <div className="card mb-3.5 px-[18px] py-4" style={{ borderLeft: '4px solid var(--accent)' }}>
          <div className="lbl">Last call summary · {friendlyTime(lastSummary.started_at || lastSummary.created_at, true)}</div>
          <p className="mt-1.5 text-[15px] leading-relaxed">{lastSummary.summary}</p>
        </div>
      )}

      <Panel title="Call history" subtitle="Click a call to see what happened" right={<span className="chip">{calls.length} calls</span>}>
        <table className="t">
          <thead>
            <tr>
              <th>Call</th>
              <th className="hidden md:table-cell">Direction</th>
              <th>Time</th>
              <th className="hidden md:table-cell">Length</th>
              <th>Type</th>
              <th className="hidden lg:table-cell">Summary</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {paged.pageItems.map((c) => (
              <tr key={c.id} className="rowbtn" onClick={() => setOpenCall(c.id)}>
                <td className="text-ink-muted">{c.id}</td>
                <td className="hidden md:table-cell">
                  <DirectionLabel direction={c.direction} />
                </td>
                <td className="whitespace-nowrap">{friendlyTime(c.started_at || c.created_at, true)}</td>
                <td className="hidden md:table-cell">{formatLength(c.duration_seconds)}</td>
                <td>
                  <CallType c={c} />
                </td>
                <td className="hidden max-w-[420px] text-[13px] text-ink-soft lg:table-cell">
                  <span className="line-clamp-2">{c.summary || '—'}</span>
                </td>
                <td className="text-right">
                  <button className="btn sm">View</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {calls.length === 0 && <EmptyState icon="phone" text="No calls yet for this patient." />}
        <Pagination paged={paged} noun="calls" />
      </Panel>

      {/* Call details */}
      <Drawer open={!!selected} onClose={() => setOpenCall(null)} title={selected ? `Call ${selected.id}` : ''} subtitle={selected ? `${name} · ${friendlyTime(selected.started_at || selected.created_at, true)}` : ''}>
        {selected && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <DirectionLabel direction={selected.direction} />
              <StatusBadge status={selected.status} />
              <CallType c={selected} />
            </div>
            <div className="kv">
              <div>
                <div className="lbl">Length</div>
                <b>{formatLength(selected.duration_seconds)}</b>
              </div>
              <div>
                <div className="lbl">Outcome</div>
                <b>
                  <OutcomeBadge outcome={selected.outcome} />
                </b>
              </div>
              <div>
                <div className="lbl">Urgency</div>
                <b>
                  <UrgencyBadge urgency={selected.urgency} />
                </b>
              </div>
            </div>
            {selected.warning_signs_detected && (
              <div className="alertbox">
                <Icon name="alert" className="h-[18px] w-[18px]" /> Warning signs detected · escalation raised
              </div>
            )}
            <div>
              <div className="lbl mb-1.5">Summary</div>
              <p className="note">{selected.summary || 'No summary was recorded for this call.'}</p>
            </div>
            {selectedAppts.map((a) => (
              <div key={a.id} className="okbox">
                Appointment: {a.doctor_name} · {a.start_at ? formatDateTime(a.start_at) : 'to be scheduled'}
              </div>
            ))}
            <div>
              <div className="lbl mb-2">Conversation</div>
              {selected.transcript ? <TranscriptView transcript={selected.transcript} agentName={info?.agent_name || 'Agent'} /> : <p className="text-ink-muted">No conversation recorded for this call.</p>}
            </div>
          </>
        )}
      </Drawer>

      <Modal open={scheduling} onClose={() => setScheduling(false)} title="Schedule a callback" subtitle={name}>
        <div className="space-y-3">
          <label className="block">
            <span className="lbl mb-1.5 block">Call back at</span>
            <input type="datetime-local" className="field" value={when} min={toLocalInput(new Date())} onChange={(e) => setWhen(e.target.value)} />
          </label>
          <label className="block">
            <span className="lbl mb-1.5 block">Note for the agent (optional)</span>
            <input className="field" value={note} maxLength={500} placeholder="e.g. check the new dose" onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn" onClick={() => setScheduling(false)}>
              Cancel
            </button>
            <button className="btn p" disabled={!when || followUp.isPending} onClick={schedule}>
              {followUp.isPending && <Spinner />} Schedule
            </button>
          </div>
        </div>
      </Modal>

      {editing && <PatientFormModal open patient={patient} onClose={() => setEditing(false)} />}
    </div>
  )
}
