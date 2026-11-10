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
          className="m-card !py-1.5 !px-2.5 !w-24 border border-[#dbe3ea] dark:border-[#243447] text-xs font-semibold"
        />
        <select
          value={unit}
          onChange={(e) => {
            const next = e.target.value as IntervalUnit
            onUnitChange(next)
            onValueChange(String(INTERVAL_LIMITS[next].presets[0]))
          }}
          className="m-card !py-1.5 !px-2.5 !w-32 border border-[#dbe3ea] dark:border-[#243447] text-xs font-semibold"
        >
          <option value="days">Days</option>
          <option value="minutes">Minutes</option>
        </select>
        {presets.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => onValueChange(String(d))}
            className={`m-tab !py-1 !px-2.5 !text-xs ${amount === d ? 'on font-bold' : ''}`}
          >
            {d}
            {short}
          </button>
        ))}
      </div>
      {!intervalValid(unit, amount) && <p className="mt-1 text-xs text-rose-600">Enter 1–{max} {unit}</p>}
      {unit === 'minutes' && (
        <p className="mt-1 text-xs font-normal text-[#56646f] dark:text-slate-400">
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
            className={`m-tab flex items-center gap-2 ${d.id === selected.id ? 'on font-bold' : ''}`}
          >
            <span>{d.display_name}</span>
            <span
              className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
                d.id === selected.id
                  ? 'bg-white/20 text-white'
                  : 'bg-[#eef2f5] dark:bg-[#101a26] text-[#56646f] dark:text-slate-300'
              }`}
            >
              {d.plans.length}
            </span>
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
          <div className="space-y-4 px-1 pb-1">
            <p className="text-sm text-[#56646f] dark:text-slate-300">{disease.description || 'No description available.'}</p>
            {p ? (
              <>
                <div>
                  <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-[#8fa1b3] dark:text-slate-400">Medication classes</p>
                  <div className="flex flex-wrap gap-1.5">
                    {p.medication_classes.map((m) => (
                      <span key={m} className="m-pill m-pill-info font-medium">{m}</span>
                    ))}
                  </div>
                </div>
                {p.lab_reminder_defaults && Object.keys(p.lab_reminder_defaults).length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-[#8fa1b3] dark:text-slate-400">Lab reminders</p>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(p.lab_reminder_defaults).map(([lab, days]) => (
                        <span key={lab} className="m-pill m-pill-warn font-medium">
                          {lab.replace(/_/g, ' ')} · every {days} days
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-[#8fa1b3] dark:text-slate-400">Escalation</p>
                  <p className="text-sm font-semibold text-[#14212e] dark:text-white">{p.escalation_instructions}</p>
                </div>
              </>
            ) : (
              <p className="text-sm text-[#8fa1b3] dark:text-slate-400">No active care protocol for this disease.</p>
            )}
          </div>
        </Panel>

        <Panel title="Red flags">
          <div className="space-y-2 px-1 pb-1">
            {p?.red_flag_criteria.map((f) => (
              <div key={f.id} className="flex items-start justify-between gap-3 rounded-xl border border-[#dbe3ea] bg-[#fafbfc] p-3 dark:border-[#243447] dark:bg-[#101a26]">
                <p className="text-sm font-semibold text-[#14212e] dark:text-white">{f.description}</p>
                <SeverityBadge severity={f.severity} />
              </div>
            ))}
            {!p?.red_flag_criteria.length && <p className="text-sm text-[#8fa1b3] dark:text-slate-400">None defined.</p>}
          </div>
        </Panel>

        <Panel title="Check-in questions">
          <ul className="space-y-2 px-1 pb-1">
            {p?.assessment_questions.map((q) => (
              <li key={q.id} className="flex items-start gap-2.5 text-sm text-[#14212e] dark:text-white">
                <span className="m-pill m-pill-mute mt-0.5 shrink-0 capitalize">{q.category}</span>
                <span className="font-medium">{q.text}</span>
              </li>
            ))}
            {!p?.assessment_questions.length && <li className="text-sm text-[#8fa1b3] dark:text-slate-400">None defined.</li>}
          </ul>
        </Panel>

        <Panel title="Education points">
          <ul className="list-disc space-y-1.5 px-5 pb-1 text-sm text-[#14212e] dark:text-white">
            {p?.education_talking_points.map((t) => <li key={t} className="font-medium">{t}</li>)}
            {!p?.education_talking_points.length && <li className="list-none text-[#8fa1b3] dark:text-slate-400">None defined.</li>}
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
      <div className="absolute inset-0 bg-[#12202e]/60 backdrop-blur-sm" onClick={onClose} />
      <div className="m-card relative max-h-[90vh] w-full max-w-lg overflow-y-auto !p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-xl font-extrabold text-[#14212e] dark:text-white">Follow-up interval</h3>
            <p className="mt-1 text-sm text-[#56646f] dark:text-slate-300">{disease.display_name}</p>
          </div>
          <button onClick={onClose} className="m-btn btn-icon !h-8 !w-8" title="Close">
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <IntervalField unit={unit} value={interval} onUnitChange={setUnit} onValueChange={setIntervalValue} />

          {unit === 'days' && (
          <Field label="Call time (clinic time)">
            <div className="flex items-center gap-2">
              <input type="time" value={callTime} onChange={(e) => setCallTime(e.target.value)} className="m-card !py-2 !px-3 !w-40 border border-[#dbe3ea] dark:border-[#243447]" />
              {callTime && (
                <button type="button" onClick={() => setCallTime('')} className="m-btn btn-sm">
                  Clear
                </button>
              )}
            </div>
            <p className="mt-1 text-xs font-normal text-[#56646f] dark:text-slate-400">
              {callTime
                ? `Follow-up calls are placed at ${hhmmTo12h(callTime)}.`
                : 'No fixed time: the next call keeps the time of day of the last call.'}
            </p>
            <p className="mt-1 text-xs font-normal text-[#56646f] dark:text-slate-400">
              The agent places these calls automatically when a patient's follow-up is due (9 AM–8 PM). Unanswered calls
              are tried 3 times, an hour apart, then flagged for staff.
            </p>
          </Field>
          )}

          <label className="flex cursor-pointer items-start gap-2.5 text-sm text-[#14212e] dark:text-white">
            <input
              type="checkbox"
              checked={applyToPlans}
              onChange={(e) => setApplyToPlans(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[#0f8f87]"
            />
            <span>
              Apply to {activePlans} active patient plan{activePlans === 1 ? '' : 's'}
              <span className="block text-xs text-[#56646f] dark:text-slate-400">
                Updates their interval and reschedules the next call. Otherwise existing plans keep their own interval.
              </span>
            </span>
          </label>
        </div>

        {error && <p className="mt-3 text-sm font-semibold text-rose-600">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="m-btn">Cancel</button>
          <button onClick={save} disabled={!valid || isPending} className="m-btn-primary">
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
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-[#dbe3ea] bg-[#fafbfc] dark:border-[#243447] dark:bg-[#101a26] text-[11px] font-extrabold uppercase text-[#56646f] dark:text-slate-400">
              <th className="px-3.5 py-2.5">Patient</th>
              <th className="px-3.5 py-2.5 col-lg">Severity</th>
              <th className="px-3.5 py-2.5">Plan duration</th>
              <th className="px-3.5 py-2.5">Next call day</th>
              <th className="px-3.5 py-2.5">Time</th>
              <th className="px-3.5 py-2.5 col-lg">Last outreach</th>
              <th className="px-3.5 py-2.5">Status</th>
              <th className="px-3.5 py-2.5">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#eef2f5] dark:divide-[#1e2f42]">
            {plans.map((pl) => {
              const due = fromUtc(pl.next_due_date)
              const isOverdue = pl.status === 'active' && due.getTime() < now
              return (
                <tr
                  key={pl.plan_id}
                  onClick={() => navigate({ to: '/patients/$id', params: { id: String(pl.patient_id) } })}
                  className="cursor-pointer hover:bg-[#fafbfc] dark:hover:bg-[#192738] transition"
                >
                  <td className="px-3.5 py-2.5">
                    <p className="font-bold text-[#14212e] dark:text-white">{pl.patient_name}</p>
                    {pl.assigned_physician_name && (
                      <p className="text-xs text-[#56646f] dark:text-slate-400">{pl.assigned_physician_name}</p>
                    )}
                  </td>
                  <td className="px-3.5 py-2.5 col-lg capitalize font-medium text-[#14212e] dark:text-white">{pl.severity || '—'}</td>
                  <td className="px-3.5 py-2.5">
                    <p className="font-semibold text-[#14212e] dark:text-white">
                      {intervalLabel(pl.followup_interval_days, pl.followup_interval_minutes)}
                    </p>
                    <p className="text-xs text-[#56646f] dark:text-slate-400">
                      {pl.followup_interval_minutes
                        ? `${pl.followup_interval_minutes} minutes`
                        : `${pl.followup_interval_days} days`}
                    </p>
                  </td>
                  <td className="px-3.5 py-2.5">
                    <p className="font-semibold text-[#14212e] dark:text-white">{due.toLocaleDateString('en-US', { weekday: 'long' })}</p>
                    <p className={`text-xs ${isOverdue ? 'font-bold text-rose-500' : 'text-[#56646f] dark:text-slate-400'}`}>
                      {due.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      {isOverdue && ' · overdue'}
                    </p>
                  </td>
                  <td className="px-3.5 py-2.5 whitespace-nowrap font-semibold text-[#14212e] dark:text-white">
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="clock" className="h-3.5 w-3.5 text-[#8fa1b3]" />
                      {due.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </td>
                  <td className="px-3.5 py-2.5 col-lg text-[#56646f] dark:text-slate-400">{formatUtcDateTime(pl.last_outreach_at)}</td>
                  <td className="px-3.5 py-2.5"><StatusBadge status={pl.status} /></td>
                  <td className="px-3.5 py-2.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditing(pl)
                      }}
                      className="m-btn btn-sm !py-1 text-xs"
                    >
                      <Icon name="edit" className="h-3.5 w-3.5" /> Edit
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
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
      <div className="absolute inset-0 bg-[#12202e]/60 backdrop-blur-sm" onClick={onClose} />
      <div className="m-card relative max-h-[90vh] w-full max-w-lg overflow-y-auto !p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-xl font-extrabold text-[#14212e] dark:text-white">Edit follow-up</h3>
            <p className="mt-1 text-sm text-[#56646f] dark:text-slate-300">{plan.patient_name}</p>
          </div>
          <button onClick={onClose} className="m-btn btn-icon !h-8 !w-8" title="Close">
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <IntervalField unit={unit} value={interval} onUnitChange={setUnit} onValueChange={setIntervalValue} />

          <div className="grid grid-cols-2 gap-3">
            <Field label="Next call date">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="m-card !py-2 !px-3 border border-[#dbe3ea] dark:border-[#243447]" />
            </Field>
            <Field label="Time">
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="m-card !py-2 !px-3 border border-[#dbe3ea] dark:border-[#243447]" />
            </Field>
          </div>
          <div className="flex items-center justify-between gap-3 text-xs text-[#56646f] dark:text-slate-400">
            <span>
              {valid
                ? nextDue.toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                : '—'}
            </span>
            <button type="button" onClick={fromNow} disabled={!amountValid} className="m-btn btn-sm">
              {unit === 'minutes' ? 'Now' : 'Today'} + {amountValid ? amount : '?'} {unit === 'minutes' ? 'min' : 'days'}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="m-card !py-2 !px-3 border border-[#dbe3ea] dark:border-[#243447]">
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="completed">Completed</option>
              </select>
            </Field>
            <Field label="Physician">
              <input value={physician} onChange={(e) => setPhysician(e.target.value)} className="m-card !py-2 !px-3 border border-[#dbe3ea] dark:border-[#243447]" placeholder="Optional" />
            </Field>
          </div>

          <Field label="Notes">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="m-card !py-2 !px-3 w-full border border-[#dbe3ea] dark:border-[#243447]" />
          </Field>
        </div>

        {error && <p className="mt-3 text-sm font-semibold text-rose-600">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="m-btn">Cancel</button>
          <button onClick={save} disabled={!valid || isPending} className="m-btn-primary">
            {isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
