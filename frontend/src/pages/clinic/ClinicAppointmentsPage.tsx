import { useEffect, useState } from 'react'
import { useClinicAppointments, useDoctors, useUpdateClinicAppointment, useClinicInfo } from '../../hooks/useClinic'
import { Icon } from '../../components/Icon'
import {
  PageHeader,
  StatCard,
  Panel,
  StatusBadge,
  EmptyState,
  Loader,
  ErrorState,
  formatTime,
  paginate,
  Pagination,
} from '../../components/ui'
import { localISODate, printAppointmentSlip } from '../../components/clinic'

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

export function ClinicAppointmentsPage() {
  const today = localISODate(new Date())
  const [range, setRange] = useState<Range>('upcoming')
  const [date, setDate] = useState(today)
  const [doctorId, setDoctorId] = useState('')
  const [status, setStatus] = useState('booked')
  const [page, setPage] = useState(1)
  const [printing, setPrinting] = useState(false)

  const params: { date_from?: string; date_to?: string; doctor_id?: number; status?: string } = {}
  if (range === 'today') {
    params.date_from = today
    params.date_to = addDays(today, 1)
  } else if (range === 'upcoming') {
    params.date_from = today
  } else if (range === 'date') {
    params.date_from = date
    params.date_to = addDays(date, 1)
  }
  if (doctorId) params.doctor_id = Number(doctorId)
  if (status) params.status = status

  const { data: appointments, isLoading, error } = useClinicAppointments(params)
  const { data: doctors } = useDoctors()
  const { data: info } = useClinicInfo()
  const { mutate: updateAppointment, isPending } = useUpdateClinicAppointment()

  // Back to the first page whenever the filters change
  const filterKey = JSON.stringify(params)
  useEffect(() => setPage(1), [filterKey])

  // Render every row while printing so the printout is the full list, not just this page
  useEffect(() => {
    if (!printing) return
    window.print()
    setPrinting(false)
  }, [printing])

  const list = appointments || []
  const paged = paginate(list, page, setPage, 7)
  const rows = printing ? list : paged.pageItems
  const rangeLabel =
    range === 'today'
      ? `Today (${new Date().toLocaleDateString('en-US', { dateStyle: 'medium' })})`
      : range === 'date'
        ? new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { dateStyle: 'medium' })
        : range === 'upcoming'
          ? 'Upcoming'
          : 'All dates'
  const doctorLabel = doctors?.find((d) => String(d.id) === doctorId)?.name

  // Group rows by day for readability
  const groups: { day: string; rows: typeof list }[] = []
  for (const a of rows) {
    const day = new Date(a.start_at).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.rows.push(a)
    else groups.push({ day, rows: [a] })
  }

  return (
    <div>
      <PageHeader
        title="Bookings"
        subtitle="Appointments booked by the callback agent, by date and doctor."
        actions={
          <button onClick={() => setPrinting(true)} disabled={list.length === 0} className="clay-btn">
            <Icon name="printer" className="h-4 w-4" /> Print List
          </button>
        }
      />

      {/* Print-only heading */}
      <div className="print-only mb-4">
        <p className="text-xl font-extrabold">{info?.clinic_name} — Appointments</p>
        <p className="text-sm">
          {rangeLabel}
          {doctorLabel ? ` · ${doctorLabel}` : ''}
          {status ? ` · ${status}` : ''} · Printed {new Date().toLocaleString('en-US')}
        </p>
      </div>

      <div className="no-print grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Showing" value={list.length} icon="calendar" tint="sky" />
        <StatCard label="Booked" value={list.filter((a) => a.status === 'booked').length} icon="clock" tint="amber" />
        <StatCard label="Completed" value={list.filter((a) => a.status === 'completed').length} icon="checkCircle" tint="mint" />
      </div>

      {/* Filters */}
      <div className="no-print mt-6 flex flex-wrap items-center gap-3">
        <div className="clay-sm flex gap-1 rounded-2xl p-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition ${
                range === r.key ? 'bg-orange-500 text-white shadow' : 'text-ink-soft hover:text-ink'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        {range === 'date' && (
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="clay-input !w-auto !py-2" />
        )}
        <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} className="clay-input !w-auto !py-2">
          <option value="">All doctors</option>
          {doctors?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} · {d.specialty}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="clay-input !w-auto !py-2">
          <option value="">All statuses</option>
          <option value="booked">Booked</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {isLoading ? (
        <Loader text="Loading appointments..." />
      ) : error ? (
        <div className="mt-6">
          <ErrorState text="Error loading appointments" />
        </div>
      ) : (
        <Panel className="mt-6">
          <div>
            <table className="clay-table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Date & Time</th>
                  <th className="col-2xl">Clinic</th>
                  <th className="col-xl">Reason</th>
                  <th>Doctor</th>
                  <th>Status</th>
                  <th className="no-print text-right">Actions</th>
                </tr>
              </thead>
              {groups.map((group) => (
                <tbody key={group.day}>
                  <tr className="!border-t-0">
                    <td colSpan={7} className="!bg-orange-50/60 !py-2 text-xs font-extrabold uppercase tracking-wider text-orange-700">
                      {group.day} · {group.rows.length} appointment{group.rows.length > 1 ? 's' : ''}
                    </td>
                  </tr>
                  {group.rows.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <p className="font-bold text-ink">{a.patient_name}</p>
                        <p className="text-xs font-semibold text-ink-soft">{a.phone_number}</p>
                      </td>
                      <td>
                        <p className="font-bold text-ink">{formatTime(a.start_at)}</p>
                        <p className="text-xs text-ink-soft">until {formatTime(a.end_at)}</p>
                      </td>
                      <td className="col-2xl text-ink-soft">{a.clinic_name}</td>
                      <td className="col-xl max-w-[240px] text-ink-soft">
                        <p className="line-clamp-2">{a.reason || '—'}</p>
                      </td>
                      <td>
                        <p className="font-semibold text-ink">{a.doctor_name}</p>
                        <p className="text-xs text-ink-soft">{a.doctor_specialty}</p>
                      </td>
                      <td>
                        <StatusBadge status={a.status} />
                      </td>
                      <td className="no-print">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => printAppointmentSlip(a)}
                            className="clay-btn-ghost btn-icon !h-8 !w-8"
                            title="Print slip"
                          >
                            <Icon name="printer" className="h-3.5 w-3.5" />
                          </button>
                          {a.status === 'booked' && (
                            <>
                              <button
                                onClick={() => updateAppointment({ id: a.id, status: 'completed' })}
                                disabled={isPending}
                                className="clay-btn-ghost btn-icon !h-8 !w-8 text-emerald-600"
                                title="Mark completed"
                              >
                                <Icon name="checkCircle" className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => {
                                  if (window.confirm(`Cancel ${a.patient_name}'s appointment?`)) {
                                    updateAppointment({ id: a.id, status: 'cancelled' })
                                  }
                                }}
                                disabled={isPending}
                                className="clay-btn-ghost btn-icon !h-8 !w-8 text-rose-500"
                                title="Cancel appointment"
                              >
                                <Icon name="xCircle" className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
            {list.length === 0 && <EmptyState icon="calendar" text="No appointments for this filter" />}
          </div>
          <Pagination paged={paged} noun="appointments" />
        </Panel>
      )}
    </div>
  )
}
