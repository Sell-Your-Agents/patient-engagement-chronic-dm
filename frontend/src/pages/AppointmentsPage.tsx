import { Fragment, useEffect, useState } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useAppointments, useUpdateAppointment, useCreateAppointment, type Appointment } from '../hooks/useAppointments'
import { useDoctors, type Doctor } from '../hooks/useClinic'
import {
  PageHeader,
  Modal,
  EmptyState,
  ErrorState,
  TableSkeleton,
  Pagination,
  Spinner,
  paginate,
  friendlyTime,
  sentenceCase,
  plainTime,
} from '../components/ui'
import { AppointmentStatusBadge, PatientFilterChip, appointmentList, WEEKDAYS, hoursLabel, localISODate, mondayIndex } from '../components/clinic'
import { toast, errorText } from '../components/toast'
import { Icon } from '../components/Icon'
import { savedAndHeard } from '../hooks/useFollowUps'
import { backTarget, useListState, useOnChange, useScrollMemory, type From } from '../lib/backNav'
import { LANGUAGE_LABELS } from '../hooks/useCalls'

type Tab = 'all' | 'pending' | 'cancel' | 'upcoming' | 'past' | 'cancelled'
const PAGE_SIZE = 15

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
  return `${day}, ${time}`
}

const tabOf = (a: Appointment, today: string): Exclude<Tab, 'all'> => appointmentList(a, today)

const CHIPS: { key: Tab; title: string; sub: string; tone: string }[] = [
  { key: 'pending', title: 'Pending', sub: 'Booked by the AI agent', tone: 't-warn' },
  { key: 'upcoming', title: 'Upcoming', sub: 'Confirmed visits', tone: 't-ok' },
  { key: 'past', title: 'Past', sub: 'Visited appointments', tone: 't-info' },
  { key: 'cancelled', title: 'Cancelled', sub: 'No longer coming', tone: 't-mute' },
  { key: 'all', title: 'All', sub: 'Every appointment', tone: 't-acc' },
]

const EMPTY_TEXT: Record<Tab, string> = {
  all: 'No appointments yet.',
  pending: 'No pending appointments. New requests from calls appear here.',
  cancel: 'No cancel requests. When a patient asks to cancel by phone, it appears here.',
  upcoming: 'No upcoming confirmed visits.',
  past: 'No past appointments yet.',
  cancelled: 'No cancelled appointments.',
}

export function AppointmentsPage() {
  const search = useSearch({ strict: false }) as { doctor?: number; patient?: number; open?: number; call?: number; from?: From }
  const navigate = useNavigate()
  // Opened from another page (Call Records, Follow-ups, Doctors, a patient): show a button back there.
  // Kept in state because the URL is cleaned after a linked appointment is opened.
  const [cameFrom] = useState(search.from)
  // Tab, doctor, search, page and the open notes: kept while a call is open, so coming back shows the list as it was
  const { state: view, set, restored } = useListState('/appointments', {
    tab: 'pending' as Tab,
    doctorId: search.doctor ? String(search.doctor) : '',
    // One patient only (from a patient's page); Clear or a refresh shows everyone again
    patientId: (search.patient || null) as number | null,
    q: '',
    page: 1,
    expanded: null as number | null,
  })
  const { tab, doctorId, patientId, q, page, expanded } = view
  const setPatientId = (v: number | null) => set('patientId', v)
  const setTab = (v: Tab) => set('tab', v)
  const setDoctorId = (v: string) => set('doctorId', v)
  const setQ = (v: string) => set('q', v)
  const setPage = (v: number) => set('page', v)
  const setExpanded = (v: number | null) => set('expanded', v)
  // A doctor link wins over a remembered doctor
  useEffect(() => {
    if (search.doctor) setDoctorId(String(search.doctor))
  }, [search.doctor]) // eslint-disable-line react-hooks/exhaustive-deps
  // A patient link (patient page) shows that patient's pending appointments
  useEffect(() => {
    if (!search.patient) return
    setPatientId(search.patient)
    setDoctorId('')
    setQ('')
    setTab('pending')
  }, [search.patient]) // eslint-disable-line react-hooks/exhaustive-deps
  // A doctor link (Doctors page) filters once; the URL is cleaned so a refresh shows every doctor again
  useEffect(() => {
    if ((search.doctor || search.patient || search.from) && !search.open && !search.call) navigate({ to: '/appointments', search: {}, replace: true })
  }, [search.doctor, search.patient]) // eslint-disable-line react-hooks/exhaustive-deps
  const [confirming, setConfirming] = useState<Appointment | null>(null)
  const [rescheduling, setRescheduling] = useState<Appointment | null>(null)
  const [cancelling, setCancelling] = useState<Appointment | null>(null)
  const [creating, setCreating] = useState(false)
  // A row opened from a link (Call Records, notifications): briefly highlighted
  const [flash, setFlash] = useState<number | null>(null)

  const { data: all, isLoading, error, refetch } = useAppointments()
  const { data: doctors } = useDoctors()
  const update = useUpdateAppointment()

  // Back to page 1 when the list changes (not when it is first shown, so a restored page stays)
  useOnChange(`${tab}|${doctorId}|${patientId}|${q}`, () => setPage(1))
  const patientName = patientId ? (all || []).filter((a) => a.patient_id === patientId).map((a) => a.patient_saved_name || a.patient_name)[0] || 'this patient' : ''
  useScrollMemory('/appointments', restored && !search.open && !search.call, !!all)

  const today = localISODate(new Date())
  const term = q.trim().toLowerCase()
  const digits = term.replace(/\D/g, '')
  const list = (all || []).filter((a) => {
    if (patientId && a.patient_id !== patientId) return false
    if (doctorId && String(a.doctor_id) !== doctorId) return false
    if (!term) return true
    const names = [a.patient_name, a.patient_saved_name, a.call_ref].filter(Boolean).join(' ').toLowerCase()
    return names.includes(term) || (digits.length >= 3 && (a.phone_number || '').replace(/\D/g, '').includes(digits))
  })
  const counts: Record<Tab, number> = { all: list.length, pending: 0, cancel: 0, upcoming: 0, past: 0, cancelled: 0 }
  for (const a of list) counts[tabOf(a, today)]++
  const shown = (tab === 'all' ? list : list.filter((a) => tabOf(a, today) === tab)).sort((a, b) => {
    // Upcoming: soonest first; Past: most recent first; otherwise newest request first (as the server sends them)
    if (tab === 'upcoming') return (a.start_at || '') < (b.start_at || '') ? -1 : 1
    if (tab === 'past') return (a.start_at || '') < (b.start_at || '') ? 1 : -1
    return 0
  })
  const doctorById = new Map((doctors || []).map((d) => [d.id, d]))
  const keepStatus = (a: Appointment) => (a.confirmed_at ? 'confirmed' : 'pending')
  const paged = paginate(shown, page, setPage, PAGE_SIZE)

  // Opened from a link: ?open=<appointment id> or ?call=<call id>. Show it in its own list, open its notes, scroll to it.
  const target = search.open || search.call
  useEffect(() => {
    if (!target || !all) return
    const a = search.open ? all.find((x) => x.id === search.open) : all.find((x) => x.call_log_id === search.call)
    navigate({ to: '/appointments', search: {}, replace: true })
    if (!a) {
      toast.info('No appointment found for that call', 'It may have been removed.')
      return
    }
    // Cancel requests have no chip here (staff handle them from Follow-ups), so they open under All
    const own_tab = tabOf(a, localISODate(new Date()))
    setTab(own_tab === 'cancel' ? 'all' : own_tab)
    setDoctorId('')
    setPatientId(null)
    setQ('')
    const own = own_tab === 'cancel' ? all : all.filter((x) => tabOf(x, localISODate(new Date())) === own_tab)
    // After the list has switched (which resets to page 1), go to the page this appointment is on
    window.setTimeout(() => setPage(Math.floor(Math.max(0, own.findIndex((x) => x.id === a.id)) / PAGE_SIZE) + 1), 0)
    setExpanded(a.id)
    setFlash(a.id)
    window.setTimeout(() => document.getElementById(`appt-${a.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150)
    window.setTimeout(() => setFlash(null), 2400)
  }, [target, all]) // eslint-disable-line react-hooks/exhaustive-deps

  const done = (msg: string, who: string) => ({
    onSuccess: () => toast.success(msg, who),
    onError: (err: unknown) => toast.error('Could not update the appointment', errorText(err, 'Please try again.')),
  })

  return (
    <div>
      <PageHeader
        title="Appointments"
        back={cameFrom ? backTarget(cameFrom, { to: '/appointments', label: 'Appointments' }) : undefined}
        // With a back button there is no room for the instruction line on one row, so it is left out then
        subtitle={cameFrom ? undefined : 'Call the patient, agree the day and time, then press Confirm. Click a row to read the notes from the call.'}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <select
              className={`field doctor-pick !h-[38px] !w-auto max-w-[220px] ${doctorId ? 'on' : ''}`}
              title={doctorId ? 'Showing only this doctor. Choose All doctors to see everyone.' : 'Show one doctor only'}
              value={doctorId} onChange={(e) => setDoctorId(e.target.value)} aria-label="Doctor">
              <option value="">All doctors</option>
              {doctors?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <input className="field !h-[38px] !w-52" placeholder="Name, phone or SS-1125" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search appointments" />
            <button className="btn p" onClick={() => setCreating(true)}>
              <Icon name="plus" className="h-4 w-4" /> New appointment
            </button>
          </div>
        }
      />

      {patientId && (
        <div className="mb-2.5">
          <PatientFilterChip name={patientName} onClear={() => setPatientId(null)} />
        </div>
      )}

      {/* One row: every list as a coloured chip (its count; click to show that list) */}
      <div className="mb-3.5">
        <div className="glance glance-fill" role="tablist" aria-label="Appointment lists">
          {CHIPS.map((c) => (
            <button key={c.key} type="button" role="tab" aria-selected={tab === c.key} className={`chip-stat ${tab === c.key ? 'on' : ''}`} onClick={() => setTab(c.key)}>
              <span className={`num ${c.tone}`}>{counts[c.key]}</span>
              <span>
                <b>{c.title}</b>
                <small>{c.sub}</small>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        {isLoading ? (
          <TableSkeleton rows={7} />
        ) : error ? (
          <div className="p-4">
            <ErrorState text="Could not load appointments" onRetry={() => refetch()} />
          </div>
        ) : shown.length === 0 ? (
          <EmptyState icon="calendar" text={term || doctorId || patientId ? 'No appointments match.' : EMPTY_TEXT[tab]} />
        ) : (
          <div className="scroll">
            {/* Each row is short; click it to open the appointment notes underneath */}
            <table className="t table-fixed w-full min-w-[880px]">
              <colgroup>
                <col style={{ width: '19%' }} />
                <col style={{ width: '19%' }} />
                <col style={{ width: '22%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '26%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Visit</th>
                  <th>Purpose of visit</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.pageItems.map((a) => {
                  const doctor = a.doctor_id ? a.doctor_name : a.doctor_requested || 'Doctor not chosen'
                  const doc = a.doctor_id ? doctorById.get(a.doctor_id) : undefined
                  const isOpen = expanded === a.id
                  const toggle = () => setExpanded(isOpen ? null : a.id)
                  const { name, said } = savedAndHeard(a)
                  const label = name || 'Patient'
                  return (
                    <Fragment key={a.id}>
                      <tr
                        id={`appt-${a.id}`}
                        className={`appt-row cursor-pointer ${isOpen ? 'appt-open' : ''} ${flash === a.id ? 'row-flash' : ''}`}
                        onClick={toggle}
                        aria-expanded={isOpen}
                        title={isOpen ? 'Click to close the notes' : 'Click to open the appointment notes'}
                      >
                        <td>
                          <b className={`person-name ${label.length > 22 ? 'long' : ''}`}>{label}</b>
                          {said && <span className="said-as">Name said on the call: {said}</span>}
                          <small className="block whitespace-nowrap text-ink-soft">{a.phone_number || 'No number'}</small>
                          {a.call_log_id && (
                            <Link
                              to="/calls/$id"
                              params={{ id: String(a.call_log_id) }}
                              search={{ from: 'appointments' }}
                              onClick={(e) => e.stopPropagation()}
                              className="call-chip mt-1.5"
                              title="Open this call: transcript and recording"
                            >
                              <Icon name="phone" className="h-3 w-3" />
                              {a.call_ref}
                              {a.call_at ? ` · ${friendlyTime(a.call_at, true)}` : ''}
                            </Link>
                          )}
                        </td>
                        <td>
                          {a.start_at ? <b className="block">{visitLabel(a.start_at)}</b> : <span className="block text-ink-muted">Day not set yet</span>}
                          <small className={`block ${a.doctor_id ? 'text-ink-soft' : 'text-ink-muted'}`}>
                            {doctor}
                            {a.doctor_id && a.doctor_specialty ? ` · ${a.doctor_specialty}` : ''}
                          </small>
                        </td>
                        <td>
                          <span className="clamp2 text-[13.5px]">{a.reason ? sentenceCase(a.reason) : <span className="text-ink-muted">No reason given</span>}</span>
                          {a.change_note && (
                            <small className={`block break-words font-bold ${a.status === 'cancel_requested' ? 'text-bad' : 'text-warn'}`}>{plainTime(a.change_note)}</small>
                          )}
                          <span className="mt-1 inline-block text-[12px] font-bold text-brand">{isOpen ? '▴ Hide notes' : '▾ Appointment notes'}</span>
                        </td>
                        <td className="overflow-hidden">
                          <AppointmentStatusBadge status={a.status} />
                          <small className="mt-1 block text-ink-muted">
                            {a.source === 'agent' ? 'AI agent' : 'Clinic staff'} · {friendlyTime(a.created_at, true)}
                          </small>
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <RowActions
                            a={a}
                            onConfirm={setConfirming}
                            onReschedule={setRescheduling}
                            onCancel={setCancelling}
                            onVisited={() => update.mutate({ id: a.id, status: 'completed' }, done('Marked as visited', label))}
                            onKeep={() => update.mutate({ id: a.id, status: keepStatus(a) }, done('Appointment kept', label))}
                            busy={update.isPending}
                          />
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="appt-notes-row">
                          <td colSpan={5}>
                            <AppointmentNotes a={a} doctorHours={doc ? availabilityLabel(doc) : null} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
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
        subtitle={cancelling ? `${savedAndHeard(cancelling).name || 'Patient'} · ${cancelling.doctor_name}${cancelling.start_at ? ` · ${visitLabel(cancelling.start_at)}` : ''}` : ''}
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
              update.mutate(
                { id: cancelling.id, status: 'cancelled' },
                { ...done('Appointment cancelled', savedAndHeard(cancelling).name || ''), onSettled: () => setCancelling(null) },
              )
            }}
          >
            Cancel appointment
          </button>
        </div>
      </Modal>
    </div>
  )
}

/** The buttons for one appointment, side by side: no hidden menu. */
function RowActions({ a, onConfirm, onReschedule, onCancel, onVisited, onKeep, busy }: {
  a: Appointment
  onConfirm: (a: Appointment) => void
  onReschedule: (a: Appointment) => void
  onCancel: (a: Appointment) => void
  onVisited: () => void
  onKeep: () => void
  busy: boolean
}) {
  const active = a.status === 'pending' || a.status === 'confirmed'
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {a.status === 'pending' && (
        <button className="btn sm p" onClick={() => onConfirm(a)} title="Mark as confirmed after you have spoken to the patient">
          <Icon name="check" className="h-3.5 w-3.5" /> Confirm
        </button>
      )}
      {a.status === 'cancel_requested' && (
        <>
          <button className="btn sm dfill" onClick={() => onCancel(a)} title="The patient asked to cancel on the phone. Confirm it and let them know">
            Confirm cancel
          </button>
          <button className="btn sm" disabled={busy} onClick={onKeep} title="The patient changed their mind: keep the appointment">
            Keep
          </button>
        </>
      )}
      {active && (
        <button className="btn sm" onClick={() => onReschedule(a)} title="Change the doctor, day or time">
          Reschedule
        </button>
      )}
      {a.status === 'confirmed' && (
        <button className="btn sm okfill" disabled={busy} onClick={onVisited} title="The patient came for the visit">
          Visited
        </button>
      )}
      {active && (
        <button className="btn sm d" onClick={() => onCancel(a)} title="Cancel this appointment and let the patient know">
          Cancel
        </button>
      )}
    </div>
  )
}

/** What opens under a row: the details with the call button beside them, then the full story of the call across the whole width. */
function AppointmentNotes({ a, doctorHours }: { a: Appointment; doctorHours: string | null }) {
  const { name, said } = savedAndHeard(a)
  const facts: [string, string | null | undefined][] = [
    ['Patient', [name, a.phone_number].filter(Boolean).join(' · ')],
    ['Name said on the call', said],
    ['Doctor', a.doctor_id ? `${a.doctor_name}${a.doctor_specialty ? ` · ${a.doctor_specialty}` : ''}` : a.doctor_requested || 'Not chosen yet'],
    ['Doctor available', doctorHours],
    ['Visit', a.start_at ? visitLabel(a.start_at) : 'Day not set yet'],
    ['Asked for', plainTime(a.preferred_time)],
    ['Reason', a.reason ? sentenceCase(a.reason) : null],
    ['Language', a.call_language ? LANGUAGE_LABELS[a.call_language] || a.call_language : null],
    ['Last change', plainTime(a.change_note)],
    ['Staff notes', a.staff_notes],
  ]

  return (
    <div className="appt-notes">
      <div className="appt-notes-top">
        <div className="min-w-0 p-4">
          <span className="lbl mb-2 block">Appointment notes</span>
          <div className="grid grid-cols-[160px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13.5px] leading-snug">
            {facts
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <Fragment key={k}>
                  <span className="text-ink-muted">{k}</span>
                  <b className="min-w-0 break-words">{v}</b>
                </Fragment>
              ))}
          </div>
        </div>
        <div className="appt-notes-aside">
          <span className="lbl">The call</span>
          {a.call_log_id ? (
            <Link to="/calls/$id" params={{ id: String(a.call_log_id) }} search={{ from: 'appointments' }} className="call-btn" title="Open the call: full transcript and recording">
              <b>Open call {a.call_ref} →</b>
              <small>{a.call_at ? `${friendlyTime(a.call_at, true)} · ` : ''}full transcript and recording</small>
            </Link>
          ) : (
            <small className="text-ink-muted">{a.source === 'agent' ? 'No call is linked to this request.' : 'Booked by clinic staff, not on a call.'}</small>
          )}
        </div>
      </div>
      {a.source === 'agent' && (
        <div className="appt-story">
          <span className="lbl mb-1.5 block">Why they called and what they said</span>
          <p>{a.call_summary || (a.call_log_id ? 'The call summary appears here a few seconds after the call ends.' : 'No call is linked to this request.')}</p>
        </div>
      )}
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
          toast.success(rescheduling ? 'Appointment rescheduled' : 'Appointment confirmed', savedAndHeard(a).name || '')
          onClose()
        },
        onError: (e) => setErr(errorText(e, 'Could not save. Check the day and time are within the doctor\'s working hours.')),
      },
    )
  }

  return (
    <Modal open onClose={onClose} title={rescheduling ? 'Reschedule appointment' : 'Confirm appointment'} subtitle={`${savedAndHeard(a).name || 'Patient'} · ${a.phone_number || 'no number'}`}>
      <div className="space-y-3.5">
        <div className="kv !grid-cols-2 text-[13px]">
          <div>
            <span className="lbl">Asked for</span>
            <b>{a.doctor_requested || '—'}</b>
          </div>
          <div>
            <span className="lbl">Preferred time</span>
            <b>{a.start_at ? visitLabel(a.start_at) : plainTime(a.preferred_time) || '—'}</b>
          </div>
          {a.reason && (
            <div className="col-span-2">
              <span className="lbl">Reason</span>
              <b>{sentenceCase(a.reason)}</b>
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
