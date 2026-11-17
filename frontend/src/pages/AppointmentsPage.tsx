import { useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useAppointments, useUpdateAppointment, useCreateAppointment, type Appointment } from '../hooks/useAppointments'
import { useDoctors, useDoctorAvailability, useClinicInfo, type Doctor } from '../hooks/useClinic'
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
  formatDateTime,
} from '../components/ui'
import { AppointmentStatusBadge, printAppointmentSlip } from '../components/clinic'
import { toast, errorText } from '../components/toast'
import { Icon } from '../components/Icon'
import { MoreText } from '../components/MoreText'
import { RowMenu, type RowMenuItem } from '../components/RowMenu'

type Tab = 'pending' | 'confirmed' | 'all'

export function AppointmentsPage() {
  const [tab, setTab] = useState<Tab>('pending')
  const [doctorId, setDoctorId] = useState('')
  const [page, setPage] = useState(1)
  const [confirming, setConfirming] = useState<Appointment | null>(null)
  const [cancelling, setCancelling] = useState<Appointment | null>(null)
  const [creating, setCreating] = useState(false)

  const { data: all, isLoading, error, refetch } = useAppointments()
  const { data: doctors } = useDoctors()
  const { data: info } = useClinicInfo()
  const update = useUpdateAppointment()

  useEffect(() => setPage(1), [tab, doctorId])

  const list = (all || []).filter((a) => !doctorId || String(a.doctor_id) === doctorId)
  const pending = list.filter((a) => a.status === 'pending')
  const now = Date.now()
  const confirmed = list
    .filter((a) => a.status === 'confirmed' && a.start_at && new Date(a.start_at).getTime() >= now - 3600_000)
    .sort((a, b) => (a.start_at! < b.start_at! ? -1 : 1))
  const shown = tab === 'pending' ? pending : tab === 'confirmed' ? confirmed : list
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
          No clinic appointment system is connected, so the agent only records requests. Call the patient, agree the time, then press{' '}
          <b>Confirm</b>. Confirming also closes the matching follow-up.
        </div>
      )}

      <div className="grid g3 mb-3.5">
        <Kpi label="Pending confirmation" value={pending.length} hint="Requests the agent recorded" icon="clock" tone="warn" />
        <Kpi label="Confirmed upcoming" value={confirmed.length} hint="Confirmed by clinic staff" icon="checkCircle" tone="ok" />
        <Kpi label="Requested by phone" value={list.filter((a) => a.source === 'agent').length} hint="All time, via the AI agent" icon="bot" tone="a" />
      </div>

      <div className="card">
        {isLoading ? (
          <TableSkeleton rows={7} />
        ) : error ? (
          <div className="p-4">
            <ErrorState text="Could not load appointments" onRetry={() => refetch()} />
          </div>
        ) : shown.length === 0 ? (
          <EmptyState icon="calendar" text={tab === 'pending' ? 'No requests waiting. New requests from calls appear here.' : 'No appointments here.'} />
        ) : (
          <div className="scroll">
            {/* Fixed widths: every row is two short lines and the table always fits the page */}
            <table className="t table-fixed w-full">
              <colgroup>
                <col style={{ width: '18%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '18%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '10%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Doctor</th>
                  <th>{tab === 'confirmed' ? 'Appointment' : 'Preferred time / slot'}</th>
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
                  const doctorSub = a.doctor_id ? a.doctor_specialty : 'as asked by caller'
                  const more: RowMenuItem[] = []
                  if (a.status === 'confirmed') {
                    more.push({ label: 'Print slip', onClick: () => printAppointmentSlip(a, info?.clinic_name || 'Clinic') })
                    more.push({ label: 'Reschedule', onClick: () => setConfirming(a) })
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
                      <td title={a.preferred_time ? `Asked for: ${a.preferred_time}` : undefined}>
                        {a.start_at ? <b className="block truncate">{formatDateTime(a.start_at)}</b> : <span className="block truncate text-ink-muted">No slot yet</span>}
                        {a.preferred_time && <small className="block truncate text-ink-muted">Asked for: {a.preferred_time}</small>}
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

      {confirming && <ConfirmModal appointment={confirming} doctors={doctors || []} onClose={() => setConfirming(null)} />}
      {creating && <CreateModal doctors={doctors || []} onClose={() => setCreating(false)} />}

      <Modal open={!!cancelling} onClose={() => setCancelling(null)} title="Cancel this appointment?" subtitle={cancelling ? `${cancelling.patient_name} · ${cancelling.doctor_name}` : ''}>
        <p className="text-ink-soft">Let the patient know it is cancelled. Any slot it held becomes free again.</p>
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

/** Pick a doctor and one of their free slots. */
function SlotPicker({ doctors, doctorId, setDoctorId, slot, setSlot, keep }: {
  doctors: Doctor[]
  doctorId: number | null
  setDoctorId: (id: number | null) => void
  slot: string
  setSlot: (s: string) => void
  /** A slot the appointment already holds (offered even though it is not "free") */
  keep?: string | null
}) {
  const { data: slots, isLoading } = useDoctorAvailability(doctorId, 14)
  const options = useMemo(() => {
    const list = [...(slots || [])]
    if (keep && !list.includes(keep)) list.unshift(keep)
    return list
  }, [slots, keep])
  const byDay = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const s of options) {
      const day = new Date(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
      m.set(day, [...(m.get(day) || []), s])
    }
    return [...m.entries()]
  }, [options])

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="lbl mb-1.5 block">Doctor</span>
        <select
          className="field"
          value={doctorId ?? ''}
          onChange={(e) => {
            setDoctorId(e.target.value ? Number(e.target.value) : null)
            setSlot('')
          }}
        >
          <option value="">Choose a doctor…</option>
          {doctors.filter((d) => d.is_active).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} · {d.specialty}
            </option>
          ))}
        </select>
      </label>
      {doctorId && (
        <div>
          <span className="lbl mb-1.5 block">Free slots (next 2 weeks)</span>
          {isLoading ? (
            <Spinner />
          ) : byDay.length === 0 ? (
            <p className="text-[13px] text-ink-muted">No free slots in the next two weeks.</p>
          ) : (
            <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {byDay.map(([day, list]) => (
                <div key={day}>
                  <small className="mb-1 block font-bold text-ink-muted">{day}</small>
                  <div className="slots">
                    {list.map((s) => (
                      <button
                        type="button"
                        key={s}
                        className={`chip ${slot === s ? '!border-brand !bg-brand !text-white' : ''}`}
                        onClick={() => setSlot(s)}
                      >
                        {new Date(s).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ConfirmModal({ appointment: a, doctors, onClose }: { appointment: Appointment; doctors: Doctor[]; onClose: () => void }) {
  const update = useUpdateAppointment()
  const [doctorId, setDoctorId] = useState<number | null>(a.doctor_id)
  const [slot, setSlot] = useState(a.start_at || '')
  const [notes, setNotes] = useState(a.staff_notes || '')
  const [err, setErr] = useState<string | null>(null)
  const rescheduling = a.status === 'confirmed'

  const save = () => {
    if (!doctorId || !slot) return
    setErr(null)
    update.mutate(
      { id: a.id, doctor_id: doctorId, start_at: slot, staff_notes: notes, status: 'confirmed' },
      {
        onSuccess: () => {
          toast.success(rescheduling ? 'Appointment moved' : 'Appointment confirmed', a.patient_name)
          onClose()
        },
        onError: (e) => setErr(errorText(e, 'Could not save. The slot may have just been taken.')),
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
        {!rescheduling && <p className="text-[13px] text-ink-soft">Call the patient first and agree the doctor and time. Confirm only what they agreed to.</p>}
        <SlotPicker doctors={doctors} doctorId={doctorId} setDoctorId={setDoctorId} slot={slot} setSlot={setSlot} keep={a.doctor_id === doctorId ? a.start_at : null} />
        <label className="block">
          <span className="lbl mb-1.5 block">Staff notes (optional)</span>
          <textarea className="field !h-20 py-2" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Spoke to Ravi, prefers evening" />
        </label>
        {err && <p className="alertbox !text-[13px]">{err}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button className="btn p" disabled={!doctorId || !slot || update.isPending} onClick={save}>
            {update.isPending && <Spinner />} {rescheduling ? 'Move appointment' : 'Confirm appointment'}
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
  const [slot, setSlot] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const valid = name.trim() && /^\+?[0-9 ()-]{7,20}$/.test(phone.trim()) && doctorId && slot

  const save = () => {
    if (!valid) return
    setErr(null)
    create.mutate(
      { patient_name: name.trim(), phone_number: phone.trim(), doctor_id: doctorId!, start_at: slot, reason: reason.trim() || undefined, confirmed: true },
      {
        onSuccess: () => {
          toast.success('Appointment booked', name.trim())
          onClose()
        },
        onError: (e) => setErr(errorText(e, 'Could not book this slot.')),
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
        <SlotPicker doctors={doctors} doctorId={doctorId} setDoctorId={setDoctorId} slot={slot} setSlot={setSlot} />
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
