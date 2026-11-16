import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useAppointments, useConfirmAppointment, useUpdateAppointment, type Appointment, type AppointmentParams } from '../hooks/useAppointments'
import { useDoctors, useClinicInfo } from '../hooks/useClinic'
import { Icon } from '../components/Icon'
import { PageHeader, Kpi, StatusBadge, EmptyState, ErrorState, Avatar, Modal, TableSkeleton, formatTime, paginate, Pagination } from '../components/ui'
import { localISODate, printAppointmentSlip } from '../components/clinic'
import { toast, errorText } from '../components/toast'

type Range = 'today' | 'upcoming' | 'date' | 'all'
const RANGES: { key: Range; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'date', label: 'Pick date' },
  { key: 'all', label: 'All' },
]

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + days)
  return localISODate(d)
}

function dayLabel(a: Appointment) {
  if (!a.start_at) return 'To be scheduled'
  const d = new Date(a.start_at)
  const today = new Date()
  const t = new Date(today)
  t.setDate(today.getDate() + 1)
  const base = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  if (d.toDateString() === today.toDateString()) return `Today · ${base}`
  if (d.toDateString() === t.toDateString()) return `Tomorrow · ${base}`
  return base
}

export function AppointmentsPage() {
  const today = localISODate(new Date())
  const [range, setRange] = useState<Range>('today')
  const [date, setDate] = useState(today)
  const [doctorId, setDoctorId] = useState('')
  const [status, setStatus] = useState('')
  const [source, setSource] = useState('')
  const [page, setPage] = useState(1)
  const [printing, setPrinting] = useState(false)
  const [cancelling, setCancelling] = useState<Appointment | null>(null)

  const params: AppointmentParams = {}
  if (range === 'today') {
    params.date_from = today
    params.date_to = addDays(today, 1)
  } else if (range === 'upcoming') params.date_from = today
  else if (range === 'date') {
    params.date_from = date
    params.date_to = addDays(date, 1)
  }
  if (doctorId) params.doctor_id = Number(doctorId)
  if (status) params.status = status
  if (source) params.source = source

  const { data: appointments, isLoading, error, refetch } = useAppointments(params)
  const { data: doctors } = useDoctors()
  const { data: info } = useClinicInfo()
  const update = useUpdateAppointment()
  const confirm = useConfirmAppointment()

  const filterKey = JSON.stringify(params)
  useEffect(() => setPage(1), [filterKey])
  useEffect(() => {
    if (!printing) return
    window.print()
    setPrinting(false)
  }, [printing])

  const list = appointments || []
  const paged = paginate(list, page, setPage, 12)
  const rows = printing ? list : paged.pageItems
  const groups: { day: string; rows: Appointment[] }[] = []
  for (const a of rows) {
    const day = dayLabel(a)
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.rows.push(a)
    else groups.push({ day, rows: [a] })
  }
  const rangeLabel = RANGES.find((r) => r.key === range)!.label

  const notify = (msg: string, who: string) => ({
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
              {RANGES.map((r) => (
                <button key={r.key} className={`tab ${range === r.key ? 'on' : ''}`} onClick={() => setRange(r.key)}>
                  {r.label}
                </button>
              ))}
            </div>
            {range === 'date' && <input type="date" className="field !h-[34px] !w-auto" value={date} onChange={(e) => setDate(e.target.value)} />}
            <select className="field !h-[34px] !w-auto font-bold" value={doctorId} onChange={(e) => setDoctorId(e.target.value)} aria-label="Doctor">
              <option value="">All doctors</option>
              {doctors?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <select className="field !h-[34px] !w-auto font-bold" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
              <option value="">All statuses</option>
              <option value="requested">Requested</option>
              <option value="booked">Booked</option>
              <option value="confirmed">Confirmed</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <select className="field !h-[34px] !w-auto font-bold" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Booked by">
              <option value="">Booked by anyone</option>
              <option value="agent">Phone agent</option>
              <option value="staff">Staff</option>
            </select>
          </div>
        }
        actions={
          <button className="btn" disabled={list.length === 0} onClick={() => setPrinting(true)}>
            <Icon name="printer" className="h-4 w-4" /> Print list
          </button>
        }
      />

      <div className="print-only mb-4">
        <p className="text-xl font-black">{info?.clinic_name} · Appointments</p>
        <p className="text-sm">
          {rangeLabel} · Printed {new Date().toLocaleString('en-GB')}
        </p>
      </div>

      <div className="grid g3 mb-3.5 no-print">
        <Kpi label="Showing" value={list.length} hint={rangeLabel} icon="calendar" tone="a" />
        <Kpi label="Awaiting confirmation" value={list.filter((a) => a.status === 'requested').length} hint="Requested by the phone agent" icon="clock" tone="warn" />
        <Kpi
          label="Booked / confirmed"
          value={list.filter((a) => a.status === 'booked' || a.status === 'confirmed').length}
          hint={`${list.filter((a) => a.source === 'agent').length} booked by the agent`}
          dir="up"
          icon="checkCircle"
          tone="ok"
        />
      </div>

      <div className="card">
        {isLoading ? (
          <TableSkeleton rows={7} />
        ) : error ? (
          <div className="p-4">
            <ErrorState text="Could not load appointments" onRetry={() => refetch()} />
          </div>
        ) : (
          <div className="scroll">
            <table className="t">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Patient</th>
                  <th>Doctor</th>
                  <th>Reason</th>
                  <th>Booked by</th>
                  <th>Status</th>
                  <th className="no-print text-right">Actions</th>
                </tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g.day}>
                  <tr>
                    <td colSpan={7} className="grp">
                      {g.day} · {g.rows.length} appointment{g.rows.length === 1 ? '' : 's'}
                    </td>
                  </tr>
                  {g.rows.map((a) => {
                    const open = ['requested', 'booked', 'confirmed'].includes(a.status)
                    return (
                      <tr key={a.id}>
                        <td className="whitespace-nowrap text-[15px] font-black">
                          {a.start_at ? formatTime(a.start_at) : '—'}
                          {a.end_at && <small className="block text-[11.5px] font-normal text-ink-muted">until {formatTime(a.end_at)}</small>}
                        </td>
                        <td>
                          <div className="who">
                            <Avatar name={a.patient_name} />
                            <div>
                              <b>
                                {a.patient_id ? (
                                  <Link to="/patients/$id" params={{ id: String(a.patient_id) }} className="text-ink hover:text-brand">
                                    {a.patient_name}
                                  </Link>
                                ) : (
                                  a.patient_name
                                )}
                              </b>
                              <small>{a.patient_id ? a.phone_number : `${a.phone_number || ''} · New patient`}</small>
                            </div>
                          </div>
                        </td>
                        <td>
                          {a.doctor_name}
                          {a.doctor_specialty && <small className="block text-ink-muted">{a.doctor_specialty}</small>}
                        </td>
                        <td className="max-w-[260px] text-ink-soft">{a.reason || '—'}</td>
                        <td>{a.source === 'agent' ? 'Phone agent' : 'Staff'}</td>
                        <td>
                          <StatusBadge status={a.status} />
                        </td>
                        <td className="no-print">
                          <div className="flex justify-end gap-1.5">
                            {a.status === 'requested' && (
                              <button className="btn sm p" disabled={confirm.isPending} onClick={() => confirm.mutate(a.id, notify('Appointment confirmed', a.patient_name))}>
                                Confirm
                              </button>
                            )}
                            {a.start_at && (
                              <button className="btn sm" onClick={() => printAppointmentSlip(a)}>
                                Slip
                              </button>
                            )}
                            {open && (
                              <button className="btn sm" disabled={update.isPending} onClick={() => update.mutate({ id: a.id, status: 'completed' }, notify('Marked as completed', a.patient_name))}>
                                Done
                              </button>
                            )}
                            {open && (
                              <button className="btn sm d" onClick={() => setCancelling(a)}>
                                Cancel
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              ))}
            </table>
            {list.length === 0 && <EmptyState icon="calendar" text="No appointments for this filter." />}
          </div>
        )}
        {!isLoading && <Pagination paged={paged} noun="appointments" />}
      </div>

      <Modal open={!!cancelling} onClose={() => setCancelling(null)} title="Cancel this appointment?" subtitle={cancelling ? `${cancelling.patient_name} · ${cancelling.doctor_name}` : ''}>
        <p className="text-ink-soft">The slot is released and other patients can book it.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn" onClick={() => setCancelling(null)}>
            Keep it
          </button>
          <button
            className="btn d"
            onClick={() => {
              if (!cancelling) return
              update.mutate({ id: cancelling.id, status: 'cancelled' }, { ...notify('Appointment cancelled', cancelling.patient_name), onSettled: () => setCancelling(null) })
            }}
          >
            Cancel appointment
          </button>
        </div>
      </Modal>
    </div>
  )
}
