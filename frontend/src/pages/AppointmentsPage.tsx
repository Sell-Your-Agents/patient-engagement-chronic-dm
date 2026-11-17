import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useAppointments, useUpdateAppointment, useCreateAppointment, type Appointment } from '../hooks/useAppointments'
import { useDoctors, useClinicInfo, type Doctor } from '../hooks/useClinic'
import {
  PageHeader,
  Kpi,
  Modal,
  Avatar,
  EmptyState,
  ErrorState,
  TableSkeleton,
  Pagination,
  Spinner,
  paginate,
  friendlyTime,
} from '../components/ui'
import { AppointmentStatusBadge, WEEKDAYS, hoursLabel, localISODate, mondayIndex, printAppointmentSlip } from '../components/clinic'
import { toast, errorText } from '../components/toast'
import { Icon } from '../components/Icon'
import { MoreText } from '../components/MoreText'
import { RowMenu, type RowMenuItem } from '../components/RowMenu'

type Tab = 'pending' | 'cancel' | 'confirmed' | 'all'

/** "Mon – Sat" for a run of days, otherwise "Mon, Wed, Fri". */
function daysLabel(days: number[]) {
  const s = [...days].sort((a, b) => a - b)
  if (!s.length) return 'no fixed days'
  const run = s.every((d, i) => i === 0 || d === s[i - 1]! + 1)
  return run && s.length >= 3 ? `${WEEKDAYS[s[0]!]} – ${WEEKDAYS[s[s.length - 1]!]}` : s.map((d) => WEEKDAYS[d]).join(', ')
}

/** "Mon – Sat, 10 AM – 2 PM" */
function availabilityLabel(d: Doctor) {
  return `${daysLabel(d.working_days)}, ${hoursLabel(d.start_time, d.end_time)}`
}

/** Why the doctor can't be visited then (null = fine). value: "YYYY-MM-DDTHH:MM". */
function visitProblem(d: Doctor, value: string): string | null {
  if (!value) return null
  const when = new Date(value)
  if (Number.isNaN(when.getTime())) return 'Choose a day and time'
  if (!d.working_days.includes(mondayIndex(when))) return `${d.name} does not work on ${WEEKDAYS[mondayIndex(when)]}. Available ${availabilityLabel(d)}.`
  const hhmm = value.slice(11, 16)
  if (hhmm < d.start_time || hhmm >= d.end_time) return `That time is outside ${d.name}'s working hours (${hoursLabel(d.start_time, d.end_time)}).`
  if (value.slice(0, 10) < localISODate(new Date())) return 'That day has already passed.'
  return null
}

/** The visit as staff read it: "Fri 21 Nov, around 2 PM". */
function visitLabel(start: string) {
  const d = new Date(start)
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(':00', '')
  return `${day}, around ${time}`
}

export function AppointmentsPage() {
  const [tab, setTab] = useState<Tab>('pending')
  const [doctorId, setDoctorId] = useState('')
  const [page, setPage] = useState(1)
  const [confirming, setConfirming] = useState<Appointment | null>(null)
  const [rescheduling, setRescheduling] = useState<Appointment | null>(null)
  const [cancelling, setCancelling] = useState<Appointment | null>(null)
  const [creating, setCreating] = useState(false)

  const { data: all, isLoading, error, refetch } = useAppointments()
  const { data: doctors } = useDoctors()
  const { data: info } = useClinicInfo()
  const update = useUpdateAppointment()

  useEffect(() => setPage(1), [tab, doctorId])

  const list = (all || []).filter((a) => !doctorId || String(a.doctor_id) === doctorId)
  const pending = list.filter((a) => a.status === 'pending')
  const cancelRequests = list.filter((a) => a.status === 'cancel_requested')
  const today = localISODate(new Date())
  const confirmed = list
    .filter((a) => a.status === 'confirmed' && a.start_at && a.start_at.slice(0, 10) >= today)
    .sort((a, b) => (a.start_at! < b.start_at! ? -1 : 1))
  const shown = tab === 'pending' ? pending : tab === 'cancel' ? cancelRequests : tab === 'confirmed' ? confirmed : list
  const doctorById = new Map((doctors || []).map((d) => [d.id, d]))
  const keepStatus = (a: Appointment) => (a.confirmed_at ? 'confirmed' : 'pending')
  const paged = paginate(shown, page, setPage, 15)

  const done = (msg: string, who: string) => ({
    onSuccess: () => toast.success(msg, who),
    onError: (err: unknown) => toast.error('Could not update the appointment', errorText(err, 'Please try again.')),
  })

  return (
    <div>
      <PageHeader
        title="Appointments"
        subtitle={
          <div className="flex flex-wrap items-center gap-2">
            <div className="tabs">
              {(
                [
                  ['pending', 'Pending confirmation', pending.length],
                  ['cancel', 'Cancel requests', cancelRequests.length],
                  ['confirmed', 'Confirmed upcoming', confirmed.length],
                  ['all', 'All', list.length],
                ] as const
              ).map(([k, l, n]) => (
                <button key={k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>
                  {l} <span className="c">{n}</span>
                </button>
              ))}
            </div>
            <select className="field !h-[34px] !w-auto font-bold" value={doctorId} onChange={(e) => setDoctorId(e.target.value)} aria-label="Doctor">
              <option value="">All doctors</option>
              {doctors?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        }
        actions={
          <button className="btn p" onClick={() => setCreating(true)}>
            <Icon name="plus" className="h-4 w-4" /> New appointment
          </button>
        }
      />

      {info?.appointment_integration === 'none' && (
        <div className="note mb-3.5 text-[13px]">
          No clinic appointment system is connected, so the agent only records requests. Call the patient, agree the day and rough time (within the
          doctor's working hours), then press <b>Confirm</b>. When a patient asks to cancel by phone, it shows under <b>Cancel requests</b> until you
          confirm it.
        </div>
      )}

      <div className="grid g3 mb-3.5">
        <Kpi label="Pending confirmation" value={pending.length} hint="Requests the agent recorded" icon="clock" tone="warn" />
        <Kpi label="Cancel requests" value={cancelRequests.length} hint="Patients asked to cancel; confirm them" icon="alert" tone="bad" />
        <Kpi label="Confirmed upcoming" value={confirmed.length} hint="Confirmed by clinic staff" icon="checkCircle" tone="ok" />
      </div>

      <div className="card">
        {isLoading ? (
          <TableSkeleton rows={7} />
        ) : error ? (
          <div className="p-4">
            <ErrorState text="Could not load appointments" onRetry={() => refetch()} />
          </div>
        ) : shown.length === 0 ? (
          <EmptyState
            icon="calendar"
            text={
              tab === 'pending'
                ? 'No requests waiting. New requests from calls appear here.'
                : tab === 'cancel'
                  ? 'No cancel requests. When a patient asks to cancel by phone, it appears here.'
                  : 'No appointments here.'
            }
          />
        ) : (
          <div className="scroll">
            {/* Fixed widths: every row is two short lines and the table always fits the page */}
            <table className="t table-fixed w-full">
              <colgroup>
                <col style={{ width: '16%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '17%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '17%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Doctor</th>
                  <th>Visit (day, rough time)</th>
                  <th>Reason</th>
                  <th>Requested</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.pageItems.map((a) => {
                  const open = a.status === 'pending' || a.status === 'confirmed'
                  const doctor = a.doctor_id ? a.doctor_name : a.doctor_requested || 'Not chosen'
                  const doc = a.doctor_id ? doctorById.get(a.doctor_id) : undefined
                  const doctorSub = a.doctor_id ? a.doctor_specialty : 'as asked by caller'
                  const more: RowMenuItem[] = []
                  if (a.status === 'confirmed') {
                    more.push({
                      label: 'Print slip',
                      onClick: () => printAppointmentSlip(a, info?.clinic_name || 'Clinic', doc ? hoursLabel(doc.start_time, doc.end_time) : undefined),
                    })
                  }
                  if (a.status === 'cancel_requested') {
                    more.push({
                      label: 'Keep appointment (patient changed mind)',
                      onClick: () => update.mutate({ id: a.id, status: keepStatus(a) }, done('Appointment kept', a.patient_name)),
                    })
                    more.push({ label: 'Reschedule instead of cancelling', onClick: () => setRescheduling(a) })
                  }
                  if (open) more.push({ label: 'Cancel appointment', danger: true, onClick: () => setCancelling(a) })
                  return (
                    <tr key={a.id}>
                      <td>
                        <div className="who min-w-0">
                          <Avatar name={a.patient_name} size={28} />
                          <div className="min-w-0">
                            <b className="block truncate" title={a.patient_name}>
                              {a.patient_id ? (
                                <Link to="/patients/$id" params={{ id: String(a.patient_id) }} className="text-ink hover:text-brand">
                                  {a.patient_name}
                                </Link>
                              ) : (
                                a.patient_name
                              )}
                            </b>
                            <small className="block truncate">{a.phone_number || '—'}</small>
                          </div>
                        </div>
                      </td>
                      <td title={[doctor, doctorSub].filter(Boolean).join(' · ')}>
                        <span className={`block truncate ${a.doctor_id ? '' : 'text-ink-soft'}`}>{doctor}</span>
                        {doctorSub && <small className="block truncate text-ink-muted">{doctorSub}</small>}
                      </td>
                      <td
                        title={[
                          a.preferred_time && `Asked for: ${a.preferred_time}`,
                          doc && `Doctor available ${availabilityLabel(doc)}`,
                          a.change_note,
                        ]
                          .filter(Boolean)
                          .join('\n')}
                      >
                        {a.start_at ? <b className="block truncate">{visitLabel(a.start_at)}</b> : <span className="block truncate text-ink-muted">Day not set yet</span>}
                        {a.change_note ? (
                          <small className={`block truncate font-bold ${a.status === 'cancel_requested' ? 'text-bad' : 'text-warn'}`}>{a.change_note}</small>
                        ) : a.preferred_time && !a.start_at ? (
                          <small className="block truncate text-ink-muted">Asked for: {a.preferred_time}</small>
                        ) : doc ? (
                          <small className="block truncate text-ink-muted">Doctor in {hoursLabel(doc.start_time, doc.end_time)}</small>
                        ) : null}
                      </td>
                      <td className="text-[13px] text-ink-soft">
                        <MoreText text={a.reason} limit={22} />
                      </td>
                      <td className="text-[13px]">
                        <span className="block truncate">{friendlyTime(a.created_at, true)}</span>
                        <small className="block truncate text-ink-muted">
                          {a.source === 'agent' ? (a.call_ref ? `AI agent · ${a.call_ref}` : 'AI agent') : 'Clinic staff'}
                        </small>
                      </td>
                      <td className="overflow-hidden">
                        <AppointmentStatusBadge status={a.status} />
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                          {a.status === 'pending' && (
                            <button className="btn sm p" onClick={() => setConfirming(a)}>
                              Confirm
                            </button>
                          )}
                          {open && (
                            <button className="btn sm" onClick={() => setRescheduling(a)} title="Change the doctor, day or time">
                              Reschedule
                            </button>
                          )}
                          {a.status === 'cancel_requested' && (
                            <button className="btn sm d" onClick={() => setCancelling(a)}>
                              Confirm cancel
                            </button>
                          )}
                          {a.status === 'confirmed' && (
                            <button
                              className="btn sm"
                              disabled={update.isPending}
                              onClick={() => update.mutate({ id: a.id, status: 'completed' }, done('Marked as completed', a.patient_name))}
                            >
                              Done
                            </button>
                          )}
                          <RowMenu items={more} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {!isLoading && <Pagination paged={paged} noun="appointments" />}
      </div>

      {confirming && <ConfirmModal appointment={confirming} doctors={doctors || []} mode="confirm" onClose={() => setConfirming(null)} />}
      {rescheduling && <ConfirmModal appointment={rescheduling} doctors={doctors || []} mode="reschedule" onClose={() => setRescheduling(null)} />}
      {creating && <CreateModal doctors={doctors || []} onClose={() => setCreating(false)} />}

      <Modal
        open={!!cancelling}
        onClose={() => setCancelling(null)}
        title={cancelling?.status === 'cancel_requested' ? 'Confirm the cancellation?' : 'Cancel this appointment?'}
        subtitle={cancelling ? `${cancelling.patient_name} · ${cancelling.doctor_name}${cancelling.start_at ? ` · ${visitLabel(cancelling.start_at)}` : ''}` : ''}
      >
        <p className="text-ink-soft">
          {cancelling?.status === 'cancel_requested'
            ? 'The patient asked to cancel this appointment on a call. Confirm it, and let the patient know it is cancelled.'
            : 'Let the patient know it is cancelled.'}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn" onClick={() => setCancelling(null)}>
            Keep it
          </button>
          <button
            className="btn d"
            disabled={update.isPending}
            onClick={() => {
              if (!cancelling) return
              update.mutate({ id: cancelling.id, status: 'cancelled' }, { ...done('Appointment cancelled', cancelling.patient_name), onSettled: () => setCancelling(null) })
            }}
          >
            Cancel appointment
          </button>
        </div>
      </Modal>
    </div>
  )
}

/** Pick a doctor, a day and a rough time within the doctor's working hours (no fixed slots). */
function VisitPicker({ doctors, doctorId, setDoctorId, visit, setVisit }: {
  doctors: Doctor[]
  doctorId: number | null
  setDoctorId: (id: number | null) => void
  /** "YYYY-MM-DDTHH:MM" (clinic time) */
  visit: string
  setVisit: (v: string) => void
}) {
  const doctor = doctors.find((d) => d.id === doctorId)
  const day = visit.slice(0, 10)
  const time = visit.slice(11, 16)
  const problem = doctor ? visitProblem(doctor, visit) : null
  const setPart = (newDay: string, newTime: string) => setVisit(newDay && newTime ? `${newDay}T${newTime}` : newDay ? `${newDay}T` : '')

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="lbl mb-1.5 block">Doctor</span>
        <select className="field" value={doctorId ?? ''} onChange={(e) => setDoctorId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Choose a doctor…</option>
          {doctors.filter((d) => d.is_active).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} · {d.specialty}
            </option>
          ))}
        </select>
      </label>
      {doctor && <p className="note !my-0 text-[13px]">Available {availabilityLabel(doctor)}. The patient comes any time within these hours.</p>}
      <div className="grid grid-cols-2 gap-3">
        <label>
          <span className="lbl mb-1.5 block">Day</span>
          <input type="date" className="field" min={localISODate(new Date())} value={day} onChange={(e) => setPart(e.target.value, time)} />
        </label>
        <label>
          <span className="lbl mb-1.5 block">Rough time</span>
          <input type="time" className="field" value={time} onChange={(e) => setPart(day, e.target.value)} />
        </label>
      </div>
      {problem && <p className="warnbox !text-[13px]">{problem}</p>}
    </div>
  )
}

/** A complete, valid visit for the chosen doctor. */
function visitOk(doctors: Doctor[], doctorId: number | null, visit: string) {
  const doctor = doctors.find((d) => d.id === doctorId)
  return !!doctor && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(visit) && !visitProblem(doctor, visit)
}

/**
 * mode "confirm": set (or keep) the doctor and visit, and confirm it.
 * mode "reschedule": move the visit to another doctor/day/time; the status stays as it is
 * (a cancel request becomes a kept appointment again).
 */
function ConfirmModal({ appointment: a, doctors, mode, onClose }: { appointment: Appointment; doctors: Doctor[]; mode: 'confirm' | 'reschedule'; onClose: () => void }) {
  const update = useUpdateAppointment()
  const [doctorId, setDoctorId] = useState<number | null>(a.doctor_id)
  const [visit, setVisit] = useState((a.start_at || '').slice(0, 16))
  const [notes, setNotes] = useState(a.staff_notes || '')
  const [err, setErr] = useState<string | null>(null)
  const rescheduling = mode === 'reschedule'
  // The visit the agent already saved is kept as it is (it was checked when it was recorded)
  const unchanged = doctorId === a.doctor_id && visit === (a.start_at || '').slice(0, 16) && !!a.start_at
  // Rescheduling needs an actual change; confirming may keep the saved visit
  const valid = !!doctorId && (rescheduling ? !unchanged && visitOk(doctors, doctorId, visit) : unchanged || visitOk(doctors, doctorId, visit))
  const status = rescheduling ? (a.status === 'cancel_requested' ? (a.confirmed_at ? 'confirmed' : 'pending') : undefined) : 'confirmed'

  const save = () => {
    if (!valid) return
    setErr(null)
    update.mutate(
      { id: a.id, doctor_id: doctorId!, start_at: visit, staff_notes: notes, ...(status ? { status } : {}) },
      {
        onSuccess: () => {
          toast.success(rescheduling ? 'Appointment rescheduled' : 'Appointment confirmed', a.patient_name)
          onClose()
        },
        onError: (e) => setErr(errorText(e, 'Could not save. Check the day and time are within the doctor\'s working hours.')),
      },
    )
  }

  return (
    <Modal open onClose={onClose} title={rescheduling ? 'Reschedule appointment' : 'Confirm appointment'} subtitle={`${a.patient_name} · ${a.phone_number || 'no number'}`}>
      <div className="space-y-3.5">
        <div className="kv !grid-cols-2 text-[13px]">
          <div>
            <span className="lbl">Asked for</span>
            <b>{a.doctor_requested || '—'}</b>
          </div>
          <div>
            <span className="lbl">Preferred time</span>
            <b>{a.preferred_time || '—'}</b>
          </div>
          {a.reason && (
            <div className="col-span-2">
              <span className="lbl">Reason</span>
              <b>{a.reason}</b>
            </div>
          )}
        </div>
        {a.change_note && <p className="warnbox !text-[13px]">{a.change_note}</p>}
        {rescheduling ? (
          <p className="text-[13px] text-ink-soft">
            Currently: <b>{a.doctor_name}</b>, <b>{a.start_at ? visitLabel(a.start_at) : 'day not set'}</b>. Choose the new doctor, day or time, and let the
            patient know. {a.status === 'confirmed' ? 'It stays confirmed.' : a.status === 'cancel_requested' ? 'This also keeps the appointment (no cancellation).' : 'It stays pending until you confirm it.'}
          </p>
        ) : (
          <p className="text-[13px] text-ink-soft">Call the patient first and agree the doctor, day and rough time. Confirm only what they agreed to.</p>
        )}
        <VisitPicker doctors={doctors} doctorId={doctorId} setDoctorId={setDoctorId} visit={visit} setVisit={setVisit} />
        <label className="block">
          <span className="lbl mb-1.5 block">Staff notes (optional)</span>
          <textarea className="field !h-20 py-2" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Spoke to Ravi, prefers evening" />
        </label>
        {err && <p className="alertbox !text-[13px]">{err}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button className="btn p" disabled={!valid || update.isPending} onClick={save}>
            {update.isPending && <Spinner />} {rescheduling ? 'Save new time' : 'Confirm appointment'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function CreateModal({ doctors, onClose }: { doctors: Doctor[]; onClose: () => void }) {
  const create = useCreateAppointment()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [reason, setReason] = useState('')
  const [doctorId, setDoctorId] = useState<number | null>(null)
  const [visit, setVisit] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const valid = name.trim() && /^\+?[0-9 ()-]{7,20}$/.test(phone.trim()) && visitOk(doctors, doctorId, visit)

  const save = () => {
    if (!valid) return
    setErr(null)
    create.mutate(
      { patient_name: name.trim(), phone_number: phone.trim(), doctor_id: doctorId!, start_at: visit, reason: reason.trim() || undefined, confirmed: true },
      {
        onSuccess: () => {
          toast.success('Appointment booked', name.trim())
          onClose()
        },
        onError: (e) => setErr(errorText(e, 'Could not book this visit.')),
      },
    )
  }

  return (
    <Modal open onClose={onClose} title="New appointment" subtitle="Book a confirmed appointment for a walk-in or a call staff took">
      <div className="space-y-3.5">
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="lbl mb-1.5 block">Patient name</span>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          <label>
            <span className="lbl mb-1.5 block">Phone</span>
            <input className="field" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" />
          </label>
        </div>
        <label className="block">
          <span className="lbl mb-1.5 block">Reason (optional)</span>
          <input className="field" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <VisitPicker doctors={doctors} doctorId={doctorId} setDoctorId={setDoctorId} visit={visit} setVisit={setVisit} />
        {err && <p className="alertbox !text-[13px]">{err}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn p" disabled={!valid || create.isPending} onClick={save}>
            {create.isPending && <Spinner />} Book appointment
          </button>
        </div>
      </div>
    </Modal>
  )
}
