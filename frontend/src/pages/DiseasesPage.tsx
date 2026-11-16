import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useDiseasesOverview, useUpdatePlan, useUpdateProtocol, type DiseaseOverview, type DiseasePlan } from '../hooks/useDiseases'
import { useCalls } from '../hooks/useCalls'
import { apiErrorMessage } from '../hooks/useClinic'
import { Icon } from '../components/Icon'
import { hhmmTo12h, localISODate } from '../components/clinic'
import { PageHeader, Panel, Kpi, StatusBadge, SeverityBadge, EmptyState, Loader, ErrorState, Avatar, Spinner, Modal, friendlyTime } from '../components/ui'
import { adherenceTone, isKnownAdherence } from '../hooks/usePatientRoster'
import { toast } from '../components/toast'

// Plan dates are stored as naive UTC.
function fromUtc(value: string) {
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`)
}

function intervalLabel(days: number, minutes?: number | null) {
  if (minutes) return minutes === 1 ? 'Every minute' : `Every ${minutes} min`
  if (days % 7 === 0) return days === 7 ? 'Every week' : `Every ${days / 7} weeks`
  return days === 1 ? 'Every day' : `Every ${days} days`
}

type IntervalUnit = 'days' | 'minutes'
const LIMITS: Record<IntervalUnit, { max: number; presets: number[]; short: string }> = {
  days: { max: 365, presets: [7, 14, 30, 90], short: 'd' },
  minutes: { max: 1440, presets: [5, 15, 30, 60], short: 'm' },
}
const intervalValid = (unit: IntervalUnit, n: number) => Number.isInteger(n) && n >= 1 && n <= LIMITS[unit].max

export function DiseasesPage() {
  const { data: diseases, isLoading, error, refetch } = useDiseasesOverview()
  const [selectedId, setSelectedId] = useState<number | null>(null)

  if (isLoading) return <Loader text="Loading chronic conditions…" />
  if (error) return <ErrorState text="Could not load chronic conditions" onRetry={() => refetch()} />
  if (!diseases?.length) {
    return (
      <div>
        <PageHeader title="Chronic Conditions" />
        <div className="card">
          <EmptyState icon="heart" text="No chronic conditions configured." />
        </div>
      </div>
    )
  }
  const selected = diseases.find((d) => d.id === selectedId) ?? diseases[0]!

  return (
    <div>
      <PageHeader title="Chronic Conditions" />
      <div className="tabs mb-4">
        {diseases.map((d) => (
          <button key={d.id} className={`tab ${d.id === selected.id ? 'on' : ''}`} onClick={() => setSelectedId(d.id)}>
            {d.display_name}
            <span className="c">{d.plans.length}</span>
          </button>
        ))}
      </div>
      <DiseaseDetail key={selected.id} disease={selected} />
    </div>
  )
}

function DiseaseDetail({ disease }: { disease: DiseaseOverview }) {
  const p = disease.protocol
  const now = Date.now()
  const active = disease.plans.filter((pl) => pl.status === 'active')
  const overdue = active.filter((pl) => fromUtc(pl.next_due_date).getTime() < now).length
  const [editing, setEditing] = useState(false)
  const urgentFlags = (p?.red_flag_criteria || []).filter((f) => ['urgent', 'critical'].includes(f.severity.toLowerCase())).length

  return (
    <>
      <div className="grid g4 mb-3.5">
        <div className="relative">
          <Kpi
            label="Follow-up interval"
            value={<span className="text-2xl">{!p ? '—' : intervalLabel(p.default_followup_interval_days, p.default_followup_interval_minutes)}</span>}
            hint={overdue ? `${overdue} overdue call${overdue === 1 ? '' : 's'}` : 'All plans on schedule'}
            dir={overdue ? 'dn' : undefined}
            icon="clock"
            tone="a"
          />
          {p && (
            <button className="btn sm absolute bottom-3 right-3" onClick={() => setEditing(true)}>
              <Icon name="edit" className="h-3.5 w-3.5" /> Edit
            </button>
          )}
        </div>
        <Kpi
          label="Call time"
          value={<span className="text-2xl">{p?.default_call_time && !p.default_followup_interval_minutes ? hhmmTo12h(p.default_call_time) : 'Flexible'}</span>}
          hint="Clinic time, 9 AM – 8 PM window"
          icon="phone"
          tone="a"
        />
        <Kpi
          label="Patients on plan"
          value={active.length}
          hint={`${disease.plans.length} plan${disease.plans.length === 1 ? '' : 's'} in total`}
          icon="users"
          tone="ok"
        />
        <Kpi label="Red flags tracked" value={p?.red_flag_criteria.length ?? 0} hint={`${urgentFlags} trigger an urgent escalation`} icon="shield" tone="bad" />
      </div>

      <div className="grid g3 mb-3.5">
        <Panel title="Red flags">
          {p?.red_flag_criteria.length ? (
            p.red_flag_criteria.map((f) => (
              <div key={f.id} className="flagrow">
                <span>{f.description}</span>
                <SeverityBadge severity={f.severity} />
              </div>
            ))
          ) : (
            <EmptyState icon="shield" text="None defined." />
          )}
        </Panel>
        <Panel title="Check-in questions" right={<span className="pill mute">{p?.assessment_questions.length ?? 0}</span>}>
          {p?.assessment_questions.length ? (
            p.assessment_questions.map((q, i) => (
              <div key={q.id} className="flagrow !justify-start">
                <b className="w-[18px] shrink-0 text-ink-muted">{i + 1}</b>
                <span className="min-w-0 flex-1">
                  {q.text}
                  <small className="mt-0.5 block text-[11px] font-bold uppercase tracking-[0.06em] text-ink-muted">{q.category}</small>
                </span>
              </div>
            ))
          ) : (
            <EmptyState icon="messages" text="None defined." />
          )}
        </Panel>
        <Panel title="Education points">
          {p?.education_talking_points.map((t) => (
            <div key={t} className="flagrow !justify-start gap-2.5">
              <Icon name="check" className="h-4 w-4 shrink-0 text-ok" strokeWidth={2.6} />
              {t}
            </div>
          ))}
          {!!p?.medication_classes.length && (
            <div className="border-t border-line-soft px-[18px] py-3">
              <div className="lbl mb-2">Medicine classes</div>
              <div className="flex flex-wrap gap-1.5">
                {p.medication_classes.map((m) => (
                  <span key={m} className="pill info">
                    {m}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Panel>
      </div>

      {(disease.description || p) && (
        <Panel title={`About ${disease.display_name}`} className="mb-3.5">
          <div className="grid gap-5 px-[18px] pb-[18px] md:grid-cols-2">
            <p className="leading-relaxed text-ink-soft">{disease.description || 'No description available.'}</p>
            {p && (
              <div className="space-y-3.5">
                {p.lab_reminder_defaults && Object.keys(p.lab_reminder_defaults).length > 0 && (
                  <div>
                    <div className="lbl mb-2">Lab reminders</div>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(p.lab_reminder_defaults).map(([lab, days]) => (
                        <span key={lab} className="pill warn">
                          {lab.replace(/_/g, ' ')} · every {days} days
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <div className="lbl mb-1.5">Escalation</div>
                  <p>{p.escalation_instructions}</p>
                </div>
              </div>
            )}
          </div>
        </Panel>
      )}

      <PlanTable plans={disease.plans} />

      {editing && p && <EditProtocolModal disease={disease} activePlans={active.length} onClose={() => setEditing(false)} />}
    </>
  )
}

function PlanTable({ plans }: { plans: DiseasePlan[] }) {
  const navigate = useNavigate()
  const { data: calls } = useCalls()
  const [editing, setEditing] = useState<DiseasePlan | null>(null)
  const now = Date.now()
  const lastAdh = (pid: number) =>
    (calls || [])
      .filter((c) => c.patient_id === pid && isKnownAdherence(c.medication_adherence_reported))
      .sort((a, b) => (b.started_at || b.created_at).localeCompare(a.started_at || a.created_at))[0]?.medication_adherence_reported

  return (
    <Panel title="Patients on this plan">
      <div className="scroll">
        <table className="t">
          <thead>
            <tr>
              <th>Patient</th>
              <th>Severity</th>
              <th>Consulting doctor</th>
              <th>Adherence</th>
              <th>Follow-up</th>
              <th>Next check-in</th>
              <th>Last outreach</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {plans.map((pl) => {
              const due = fromUtc(pl.next_due_date)
              const late = pl.status === 'active' && due.getTime() < now
              const adh = lastAdh(pl.patient_id)
              return (
                <tr key={pl.plan_id} className="rowbtn" onClick={() => navigate({ to: '/patients/$id', params: { id: String(pl.patient_id) } })}>
                  <td>
                    <div className="who">
                      <Avatar name={pl.patient_name} />
                      <div>
                        <b>{pl.patient_name}</b>
                        <small>Plan {pl.plan_id}</small>
                      </div>
                    </div>
                  </td>
                  <td className="capitalize">{pl.severity || '—'}</td>
                  <td>{pl.assigned_physician_name || <span className="text-ink-muted">—</span>}</td>
                  <td>{adh ? <span className={`pill ${adherenceTone(adh)} capitalize`}>{adh}</span> : <span className="text-[13px] text-ink-muted">Not reported</span>}</td>
                  <td>{intervalLabel(pl.followup_interval_days, pl.followup_interval_minutes)}</td>
                  <td className="whitespace-nowrap">
                    <span className={late ? 'font-bold text-bad' : ''}>{friendlyTime(pl.next_due_date, true)}</span>
                    {late && <small className="block font-bold text-bad">Overdue</small>}
                  </td>
                  <td className="whitespace-nowrap text-ink-soft">{pl.last_outreach_at ? friendlyTime(pl.last_outreach_at, true) : '—'}</td>
                  <td>
                    <StatusBadge status={pl.status} />
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1.5">
                      <button className="btn sm" onClick={() => setEditing(pl)}>
                        <Icon name="edit" className="h-3.5 w-3.5" /> Edit
                      </button>
                      <button className="btn sm" onClick={() => navigate({ to: '/patients/$id', params: { id: String(pl.patient_id) } })}>
                        View
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {plans.length === 0 && <EmptyState icon="users" text="No patients on this plan yet." />}
      </div>
      {editing && <EditPlanModal plan={editing} onClose={() => setEditing(null)} />}
    </Panel>
  )
}

function IntervalField({ unit, value, onUnit, onValue }: { unit: IntervalUnit; value: string; onUnit: (u: IntervalUnit) => void; onValue: (v: string) => void }) {
  const { max, presets, short } = LIMITS[unit]
  const n = Number(value)
  return (
    <div>
      <div className="lbl mb-1.5">Follow-up every</div>
      <div className="flex flex-wrap items-center gap-2">
        <input type="number" min={1} max={max} value={value} onChange={(e) => onValue(e.target.value)} className="field !w-24" />
        <select
          className="field !w-32"
          value={unit}
          onChange={(e) => {
            const next = e.target.value as IntervalUnit
            onUnit(next)
            onValue(String(LIMITS[next].presets[0]))
          }}
        >
          <option value="days">Days</option>
          <option value="minutes">Minutes</option>
        </select>
        {presets.map((d) => (
          <button key={d} type="button" className={`btn sm ${n === d ? 'p' : ''}`} onClick={() => onValue(String(d))}>
            {d}
            {short}
          </button>
        ))}
      </div>
      {!intervalValid(unit, n) && <p className="mt-1 text-xs text-bad">Enter 1–{max} {unit}</p>}
      {unit === 'minutes' && <p className="mt-1 text-xs text-ink-muted">The agent calls every few minutes at any hour. Mainly for testing.</p>}
    </div>
  )
}

function EditProtocolModal({ disease, activePlans, onClose }: { disease: DiseaseOverview; activePlans: number; onClose: () => void }) {
  const p = disease.protocol!
  const { mutate, isPending } = useUpdateProtocol()
  const [unit, setUnit] = useState<IntervalUnit>(p.default_followup_interval_minutes ? 'minutes' : 'days')
  const [interval, setIntervalValue] = useState(String(p.default_followup_interval_minutes || p.default_followup_interval_days))
  const [callTime, setCallTime] = useState(p.default_call_time || '')
  const [apply, setApply] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const n = Number(interval)
  const valid = intervalValid(unit, n)

  const save = () => {
    if (!valid) return
    setError(null)
    mutate(
      {
        conditionId: disease.id,
        updates: {
          ...(unit === 'days' ? { default_followup_interval_days: n, default_followup_interval_minutes: null } : { default_followup_interval_minutes: n }),
          default_call_time: callTime || null,
          apply_to_plans: apply,
        },
      },
      {
        onSuccess: () => {
          toast.success('Follow-up interval saved', disease.display_name)
          onClose()
        },
        onError: (err) => setError(apiErrorMessage(err, 'Failed to update follow-up interval')),
      },
    )
  }

  return (
    <Modal open onClose={onClose} title="Follow-up interval" subtitle={disease.display_name}>
      <div className="space-y-4">
        <IntervalField unit={unit} value={interval} onUnit={setUnit} onValue={setIntervalValue} />
        {unit === 'days' && (
          <div>
            <div className="lbl mb-1.5">Call time (clinic time)</div>
            <div className="flex items-center gap-2">
              <input type="time" className="field !w-40" value={callTime} onChange={(e) => setCallTime(e.target.value)} />
              {callTime && (
                <button type="button" className="btn sm" onClick={() => setCallTime('')}>
                  Clear
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              {callTime ? `Follow-up calls are placed at ${hhmmTo12h(callTime)}.` : 'No fixed time: the next call keeps the time of day of the last call.'} Unanswered calls are
              tried 3 times, an hour apart, then flagged for staff.
            </p>
          </div>
        )}
        <label className="flex cursor-pointer items-start gap-2.5">
          <input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} className="mt-0.5 h-4 w-4" style={{ accentColor: 'var(--accent)' }} />
          <span>
            Apply to {activePlans} active patient plan{activePlans === 1 ? '' : 's'}
            <small className="block text-ink-muted">Updates their interval and reschedules the next call.</small>
          </span>
        </label>
        {error && <p className="text-sm font-bold text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn p" disabled={!valid || isPending} onClick={save}>
            {isPending && <Spinner />} Save
          </button>
        </div>
      </div>
    </Modal>
  )
}

function toTimeInput(d: Date) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function EditPlanModal({ plan, onClose }: { plan: DiseasePlan; onClose: () => void }) {
  const { mutate, isPending } = useUpdatePlan()
  const due = fromUtc(plan.next_due_date)
  const [unit, setUnit] = useState<IntervalUnit>(plan.followup_interval_minutes ? 'minutes' : 'days')
  const [interval, setIntervalValue] = useState(String(plan.followup_interval_minutes || plan.followup_interval_days))
  const [date, setDate] = useState(localISODate(due))
  const [time, setTime] = useState(toTimeInput(due))
  const [status, setStatus] = useState(plan.status)
  const [physician, setPhysician] = useState(plan.assigned_physician_name || '')
  const [notes, setNotes] = useState(plan.notes || '')
  const [error, setError] = useState<string | null>(null)
  const n = Number(interval)
  const nOk = intervalValid(unit, n)
  const next = new Date(`${date}T${time || '00:00'}`)
  const valid = nOk && !!date && !Number.isNaN(next.getTime())

  const fromNow = () => {
    const d = new Date()
    if (unit === 'minutes') {
      d.setMinutes(d.getMinutes() + n)
      setTime(toTimeInput(d))
    } else d.setDate(d.getDate() + n)
    setDate(localISODate(d))
  }

  const save = () => {
    if (!valid) return
    setError(null)
    mutate(
      {
        id: plan.plan_id,
        updates: {
          ...(unit === 'days' ? { followup_interval_days: n, followup_interval_minutes: null } : { followup_interval_minutes: n }),
          next_due_date: next.toISOString(),
          status,
          assigned_physician_name: physician.trim() || null,
          notes: notes.trim() || null,
        },
      },
      {
        onSuccess: () => {
          toast.success('Follow-up updated', plan.patient_name)
          onClose()
        },
        onError: (err) => setError(apiErrorMessage(err, 'Failed to update follow-up')),
      },
    )
  }

  return (
    <Modal open onClose={onClose} title="Edit follow-up" subtitle={plan.patient_name}>
      <div className="space-y-4">
        <IntervalField unit={unit} value={interval} onUnit={setUnit} onValue={setIntervalValue} />
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="lbl mb-1.5 block">Next call date</span>
            <input type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            <span className="lbl mb-1.5 block">Time</span>
            <input type="time" className="field" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        </div>
        <div className="flex items-center justify-between gap-3 text-xs text-ink-muted">
          <span>{valid ? next.toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}</span>
          <button type="button" className="btn sm" disabled={!nOk} onClick={fromNow}>
            {unit === 'minutes' ? 'Now' : 'Today'} + {nOk ? n : '?'} {unit === 'minutes' ? 'min' : 'days'}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="lbl mb-1.5 block">Status</span>
            <select className="field" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="completed">Completed</option>
            </select>
          </label>
          <label>
            <span className="lbl mb-1.5 block">Physician</span>
            <input className="field" value={physician} onChange={(e) => setPhysician(e.target.value)} placeholder="Optional" />
          </label>
        </div>
        <label className="block">
          <span className="lbl mb-1.5 block">Notes</span>
          <textarea className="field" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        {error && <p className="text-sm font-bold text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn p" disabled={!valid || isPending} onClick={save}>
            {isPending && <Spinner />} Save
          </button>
        </div>
      </div>
    </Modal>
  )
}
