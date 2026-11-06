import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  useDiseasesOverview,
  useUpdatePlan,
  useUpdateProtocol,
  type DiseaseOverview,
  type DiseasePlan,
} from '../hooks/useDiseases'
import { apiErrorMessage } from '../hooks/useClinic'
import { Icon } from '../components/Icon'
import { hhmmTo12h, localISODate } from '../components/clinic'
import {
  PageHeader,
  Panel,
  StatCard,
  StatusBadge,
  SeverityBadge,
  EmptyState,
  Loader,
  ErrorState,
  formatUtcDateTime,
  Field,
} from '../components/ui'

// Plan dates are stored as naive UTC.
function fromUtc(value: string) {
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`)
}

function intervalLabel(days: number, minutes?: number | null) {
  if (minutes) return minutes === 1 ? 'Every minute' : `Every ${minutes} minutes`
  if (days % 7 === 0) {
    const weeks = days / 7
    return weeks === 1 ? 'Every week' : `Every ${weeks} weeks`
  }
  return days === 1 ? 'Every day' : `Every ${days} days`
}

type IntervalUnit = 'days' | 'minutes'

const INTERVAL_LIMITS: Record<IntervalUnit, { max: number; presets: number[]; short: string }> = {
  days: { max: 365, presets: [7, 14, 30, 90], short: 'd' },
  minutes: { max: 1440, presets: [5, 15, 30, 60], short: 'm' },
}

function intervalValid(unit: IntervalUnit, amount: number) {
  return Number.isInteger(amount) && amount >= 1 && amount <= INTERVAL_LIMITS[unit].max
}

/** "Follow-up every N days / minutes" with a unit switch and quick picks. */
function IntervalField({
  unit,
  value,
  onUnitChange,
  onValueChange,
}: {
  unit: IntervalUnit
  value: string
  onUnitChange: (unit: IntervalUnit) => void
  onValueChange: (value: string) => void
}) {
  const { max, presets, short } = INTERVAL_LIMITS[unit]
  const amount = Number(value)
  return (
    <Field label="Follow-up every">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={1}
          max={max}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          className="clay-input !w-24"
        />
        <select
          value={unit}
          onChange={(e) => {
            const next = e.target.value as IntervalUnit
            onUnitChange(next)
            onValueChange(String(INTERVAL_LIMITS[next].presets[0]))
          }}
          className="clay-input !w-32"
        >
          <option value="days">Days</option>
          <option value="minutes">Minutes</option>
        </select>
        {presets.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => onValueChange(String(d))}
            className={amount === d ? 'clay-btn btn-sm' : 'clay-btn-ghost btn-sm'}
          >
            {d}
            {short}
          </button>
        ))}
      </div>
      {!intervalValid(unit, amount) && <p className="mt-1 text-xs text-rose-600">Enter 1–{max} {unit}</p>}
      {unit === 'minutes' && (
        <p className="mt-1 text-xs font-normal text-ink-soft">
          The agent calls every {intervalValid(unit, amount) ? amount : 'N'} minutes, at any hour (call time and
          calling hours don't apply). Mainly for testing.
        </p>
      )}
    </Field>
  )
}

export function DiseasesPage() {
  const { data: diseases, isLoading, error } = useDiseasesOverview()
  const [selectedId, setSelectedId] = useState<number | null>(null)

  if (isLoading) return <Loader text="Loading chronic conditions..." />
  if (error) return <ErrorState text="Error loading chronic conditions" />
  if (!diseases?.length) {
    return (
      <div>
        <PageHeader title="Chronic Condition" subtitle="Chronic conditions, their care protocols and patient plan schedules." />
        <EmptyState icon="heart" text="No diseases configured" />
      </div>
    )
  }

  const selected = diseases.find((d) => d.id === selectedId) ?? diseases[0]

  return (
    <div>
      <PageHeader title="Chronic Condition" subtitle="Chronic conditions, their care protocols and patient plan schedules." />

      {/* Disease picker */}
      <div className="mb-5 flex flex-wrap gap-2">
        {diseases.map((d) => (
          <button
            key={d.id}
            onClick={() => setSelectedId(d.id)}
            className={d.id === selected.id ? 'clay-btn btn-sm' : 'clay-btn-ghost btn-sm'}
          >
            {d.display_name}
            <span className="rounded-full bg-white/60 px-1.5 text-[11px] font-bold">{d.plans.length}</span>
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
  const activePlans = disease.plans.filter((pl) => pl.status === 'active')
  const overdue = activePlans.filter((pl) => fromUtc(pl.next_due_date).getTime() < now).length
  const [editingProtocol, setEditingProtocol] = useState(false)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div className="relative">
          <StatCard
            label={
              p?.default_call_time && !p.default_followup_interval_minutes
                ? `Follow-up interval · at ${hhmmTo12h(p.default_call_time)}`
                : 'Follow-up interval'
            }
            value={
              !p
                ? '—'
                : p.default_followup_interval_minutes
                  ? `${p.default_followup_interval_minutes} min`
                  : `${p.default_followup_interval_days} days`
            }
            icon="clock"
            tint="peach"
          />
          {p && (
            <button
              onClick={() => setEditingProtocol(true)}
              className="clay-btn-ghost btn-icon absolute right-2 top-2 !h-7 !w-7"
              title="Edit follow-up interval and time"
            >
              <Icon name="edit" className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <StatCard label="Active plans" value={activePlans.length} icon="users" tint="mint" />
        <StatCard label="Overdue calls" value={overdue} icon="alert" tint="coral" />
        <StatCard label="Red flags tracked" value={p?.red_flag_criteria.length ?? 0} icon="shield" tint="lavender" />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title="About this disease">
          <div className="space-y-4 px-5 pb-5">
            <p className="text-sm text-ink-soft">{disease.description || 'No description available.'}</p>
            {p ? (
              <>
                <div>
                  <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-muted">Medication classes</p>
                  <div className="flex flex-wrap gap-1.5">
                    {p.medication_classes.map((m) => (
                      <span key={m} className="pill bg-sky-100 text-sky-700">{m}</span>
                    ))}
                  </div>
                </div>
                {p.lab_reminder_defaults && Object.keys(p.lab_reminder_defaults).length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-muted">Lab reminders</p>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(p.lab_reminder_defaults).map(([lab, days]) => (
                        <span key={lab} className="pill bg-amber-100 text-amber-700">
                          {lab.replace(/_/g, ' ')} · every {days} days
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-muted">Escalation</p>
                  <p className="text-sm text-ink">{p.escalation_instructions}</p>
                </div>
              </>
            ) : (
              <p className="text-sm text-ink-muted">No active care protocol for this disease.</p>
            )}
          </div>
        </Panel>

        <Panel title="Red flags">
          <div className="space-y-2 px-5 pb-5">
            {p?.red_flag_criteria.map((f) => (
              <div key={f.id} className="clay-inset flex items-start justify-between gap-3 rounded-2xl p-3">
                <p className="text-sm text-ink">{f.description}</p>
                <SeverityBadge severity={f.severity} />
              </div>
            ))}
            {!p?.red_flag_criteria.length && <p className="text-sm text-ink-muted">None defined.</p>}
          </div>
        </Panel>

        <Panel title="Check-in questions">
          <ul className="space-y-2 px-5 pb-5">
            {p?.assessment_questions.map((q) => (
              <li key={q.id} className="flex items-start gap-2 text-sm text-ink">
                <span className="pill mt-0.5 shrink-0 bg-slate-100 capitalize text-slate-700">{q.category}</span>
                <span>{q.text}</span>
              </li>
            ))}
            {!p?.assessment_questions.length && <li className="text-sm text-ink-muted">None defined.</li>}
          </ul>
        </Panel>

        <Panel title="Education points">
          <ul className="list-disc space-y-1.5 px-5 pb-5 pl-9 text-sm text-ink">
            {p?.education_talking_points.map((t) => <li key={t}>{t}</li>)}
            {!p?.education_talking_points.length && <li className="list-none text-ink-muted">None defined.</li>}
          </ul>
        </Panel>
      </div>

      <PlanSchedule plans={disease.plans} />

      {editingProtocol && p && (
        <EditProtocolModal
          disease={disease}
          activePlans={activePlans.length}
          onClose={() => setEditingProtocol(false)}
        />
      )}
    </div>
  )
}

function EditProtocolModal({
  disease,
  activePlans,
  onClose,
}: {
  disease: DiseaseOverview
  activePlans: number
  onClose: () => void
}) {
  const p = disease.protocol!
  const { mutate: updateProtocol, isPending } = useUpdateProtocol()
  const [unit, setUnit] = useState<IntervalUnit>(p.default_followup_interval_minutes ? 'minutes' : 'days')
  const [interval, setIntervalValue] = useState(String(p.default_followup_interval_minutes || p.default_followup_interval_days))
  const [callTime, setCallTime] = useState(p.default_call_time || '')
  const [applyToPlans, setApplyToPlans] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const amount = Number(interval)
  const valid = intervalValid(unit, amount)

  const save = () => {
    if (!valid) return
    setError(null)
    updateProtocol(
      {
        conditionId: disease.id,
        updates: {
          // Minutes keep the days setting as it was, for switching back
          ...(unit === 'days'
            ? { default_followup_interval_days: amount, default_followup_interval_minutes: null }
            : { default_followup_interval_minutes: amount }),
          default_call_time: callTime || null,
          apply_to_plans: applyToPlans,
        },
      },
      {
        onSuccess: onClose,
        onError: (err) => setError(apiErrorMessage(err, 'Failed to update follow-up interval')),
      }
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/25 backdrop-blur-sm" onClick={onClose} />
      <div className="clay clay-scroll relative max-h-[90vh] w-full max-w-lg overflow-y-auto p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-xl font-extrabold text-ink">Follow-up interval</h3>
            <p className="mt-1 text-sm text-ink-soft">{disease.display_name}</p>
          </div>
          <button onClick={onClose} className="clay-btn-ghost btn-icon" title="Close">
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <IntervalField unit={unit} value={interval} onUnitChange={setUnit} onValueChange={setIntervalValue} />

          {unit === 'days' && (
          <Field label="Call time (clinic time)">
            <div className="flex items-center gap-2">
              <input type="time" value={callTime} onChange={(e) => setCallTime(e.target.value)} className="clay-input !w-40" />
              {callTime && (
                <button type="button" onClick={() => setCallTime('')} className="clay-btn-ghost btn-sm">
                  Clear
                </button>
              )}
            </div>
            <p className="mt-1 text-xs font-normal text-ink-soft">
              {callTime
                ? `Follow-up calls are placed at ${hhmmTo12h(callTime)}.`
                : 'No fixed time: the next call keeps the time of day of the last call.'}
            </p>
            <p className="mt-1 text-xs font-normal text-ink-soft">
              The agent places these calls automatically when a patient's follow-up is due (9 AM–8 PM). Unanswered calls
              are tried 3 times, an hour apart, then flagged for staff.
            </p>
          </Field>
          )}

          <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink">
            <input
              type="checkbox"
              checked={applyToPlans}
              onChange={(e) => setApplyToPlans(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-orange-500"
            />
            <span>
              Apply to {activePlans} active patient plan{activePlans === 1 ? '' : 's'}
              <span className="block text-xs text-ink-soft">
                Updates their interval and reschedules the next call. Otherwise existing plans keep their own interval.
              </span>
            </span>
          </label>
        </div>

        {error && <p className="mt-3 text-sm font-semibold text-rose-600">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="clay-btn-ghost">Cancel</button>
          <button onClick={save} disabled={!valid || isPending} className="clay-btn">
            {isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function PlanSchedule({ plans }: { plans: DiseasePlan[] }) {
  const navigate = useNavigate()
  const [editing, setEditing] = useState<DiseasePlan | null>(null)
  const now = Date.now()

  return (
    <Panel title="Patient plans & schedule">
      <table className="clay-table w-full">
        <thead>
          <tr>
            <th>Patient</th>
            <th className="col-lg">Severity</th>
            <th>Plan duration</th>
            <th>Next call day</th>
            <th>Time</th>
            <th className="col-lg">Last outreach</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {plans.map((pl) => {
            const due = fromUtc(pl.next_due_date)
            const isOverdue = pl.status === 'active' && due.getTime() < now
            return (
              <tr
                key={pl.plan_id}
                onClick={() => navigate({ to: '/patients/$id', params: { id: String(pl.patient_id) } })}
                className="cursor-pointer"
              >
                <td>
                  <p className="font-bold text-ink">{pl.patient_name}</p>
                  {pl.assigned_physician_name && <p className="text-xs text-ink-soft">{pl.assigned_physician_name}</p>}
                </td>
                <td className="col-lg capitalize">{pl.severity || '—'}</td>
                <td>
                  <p className="font-semibold text-ink">
                    {intervalLabel(pl.followup_interval_days, pl.followup_interval_minutes)}
                  </p>
                  <p className="text-xs text-ink-soft">
                    {pl.followup_interval_minutes
                      ? `${pl.followup_interval_minutes} minutes`
                      : `${pl.followup_interval_days} days`}
                  </p>
                </td>
                <td>
                  <p className="font-semibold text-ink">{due.toLocaleDateString('en-US', { weekday: 'long' })}</p>
                  <p className={`text-xs ${isOverdue ? 'font-bold text-rose-600' : 'text-ink-soft'}`}>
                    {due.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    {isOverdue && ' · overdue'}
                  </p>
                </td>
                <td className="whitespace-nowrap font-semibold text-ink">
                  <span className="inline-flex items-center gap-1.5">
                    <Icon name="clock" className="h-3.5 w-3.5 text-ink-muted" />
                    {due.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </span>
                </td>
                <td className="col-lg text-ink-soft">{formatUtcDateTime(pl.last_outreach_at)}</td>
                <td><StatusBadge status={pl.status} /></td>
                <td>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditing(pl)
                    }}
                    className="clay-btn-ghost btn-sm"
                  >
                    <Icon name="edit" className="h-3.5 w-3.5" /> Edit
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {plans.length === 0 && <EmptyState icon="calendar" text="No patients on a plan for this disease" />}
      {editing && <EditFollowUpModal plan={editing} onClose={() => setEditing(null)} />}
    </Panel>
  )
}

function toTimeInput(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function EditFollowUpModal({ plan, onClose }: { plan: DiseasePlan; onClose: () => void }) {
  const { mutate: updatePlan, isPending } = useUpdatePlan()
  const due = fromUtc(plan.next_due_date)
  const [unit, setUnit] = useState<IntervalUnit>(plan.followup_interval_minutes ? 'minutes' : 'days')
  const [interval, setIntervalValue] = useState(String(plan.followup_interval_minutes || plan.followup_interval_days))
  const [date, setDate] = useState(localISODate(due))
  const [time, setTime] = useState(toTimeInput(due))
  const [status, setStatus] = useState(plan.status)
  const [physician, setPhysician] = useState(plan.assigned_physician_name || '')
  const [notes, setNotes] = useState(plan.notes || '')
  const [error, setError] = useState<string | null>(null)

  const amount = Number(interval)
  const amountValid = intervalValid(unit, amount)
  const nextDue = new Date(`${date}T${time || '00:00'}`)
  const valid = amountValid && !!date && !Number.isNaN(nextDue.getTime())

  // Schedule the next call one interval from now (days keep the chosen time).
  const fromNow = () => {
    const d = new Date()
    if (unit === 'minutes') {
      d.setMinutes(d.getMinutes() + amount)
      setTime(toTimeInput(d))
    } else {
      d.setDate(d.getDate() + amount)
    }
    setDate(localISODate(d))
  }

  const save = () => {
    if (!valid) return
    setError(null)
    updatePlan(
      {
        id: plan.plan_id,
        updates: {
          // Minutes keep the days setting as it was, for switching back
          ...(unit === 'days'
            ? { followup_interval_days: amount, followup_interval_minutes: null }
            : { followup_interval_minutes: amount }),
          next_due_date: nextDue.toISOString(),
          status,
          assigned_physician_name: physician.trim() || null,
          notes: notes.trim() || null,
        },
      },
      {
        onSuccess: onClose,
        onError: (err) => setError(apiErrorMessage(err, 'Failed to update follow-up')),
      }
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/25 backdrop-blur-sm" onClick={onClose} />
      <div className="clay clay-scroll relative max-h-[90vh] w-full max-w-lg overflow-y-auto p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-xl font-extrabold text-ink">Edit follow-up</h3>
            <p className="mt-1 text-sm text-ink-soft">{plan.patient_name}</p>
          </div>
          <button onClick={onClose} className="clay-btn-ghost btn-icon" title="Close">
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <IntervalField unit={unit} value={interval} onUnitChange={setUnit} onValueChange={setIntervalValue} />

          <div className="grid grid-cols-2 gap-3">
            <Field label="Next call date">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="clay-input" />
            </Field>
            <Field label="Time">
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="clay-input" />
            </Field>
          </div>
          <div className="flex items-center justify-between gap-3 text-xs text-ink-soft">
            <span>
              {valid
                ? nextDue.toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                : '—'}
            </span>
            <button type="button" onClick={fromNow} disabled={!amountValid} className="clay-btn-ghost btn-sm">
              {unit === 'minutes' ? 'Now' : 'Today'} + {amountValid ? amount : '?'} {unit === 'minutes' ? 'min' : 'days'}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="clay-input">
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="completed">Completed</option>
              </select>
            </Field>
            <Field label="Physician">
              <input value={physician} onChange={(e) => setPhysician(e.target.value)} className="clay-input" placeholder="Optional" />
            </Field>
          </div>

          <Field label="Notes">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="clay-input" />
          </Field>
        </div>

        {error && <p className="mt-3 text-sm font-semibold text-rose-600">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="clay-btn-ghost">Cancel</button>
          <button onClick={save} disabled={!valid || isPending} className="clay-btn">
            {isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
