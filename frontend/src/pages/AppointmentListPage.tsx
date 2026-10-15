import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useAppointments, useConfirmAppointment } from '../hooks/useAppointments'
import { usePatients } from '../hooks/usePatients'
import { Icon } from '../components/Icon'
import {
  PageHeader,
  StatCard,
  StatusBadge,
  EmptyState,
  Loader,
  ErrorState,
  formatShortDateTime,
  paginate,
  Pagination,
} from '../components/ui'

export function AppointmentListPage() {
  const { data: appointments, isLoading, error } = useAppointments()
  const { data: patients } = usePatients(0, 100)
  const { mutate: confirmAppointment, isPending, variables } = useConfirmAppointment()
  const [page, setPage] = useState(1)

  if (isLoading) return <Loader text="Loading appointments..." />
  if (error) return <ErrorState text="Error loading appointments" />

  const patientById = new Map(patients?.map((p) => [p.id, p]) || [])
  const list = appointments || []
  const requested = list.filter((a) => a.status === 'requested')
  const confirmed = list.filter((a) => a.status === 'confirmed')
  const paged = paginate(list, page, setPage, 7)

  return (
    <div>
      <PageHeader title="Appointments" subtitle="Appointments requested by patients during outreach calls." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Total" value={list.length} icon="calendar" tint="sky" />
        <StatCard label="Awaiting Confirmation" value={requested.length} icon="clock" tint="amber" />
        <StatCard label="Confirmed" value={confirmed.length} icon="checkCircle" tint="mint" />
      </div>

      <div className="clay mt-6 overflow-hidden">
        <div>
          <table className="clay-table w-full">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Physician</th>
                <th className="col-md">Scheduled</th>
                <th className="col-xl">Duration</th>
                <th className="col-lg">Reason</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {paged.pageItems.map((a) => {
                const patient = patientById.get(a.patient_id)
                return (
                  <tr key={a.id}>
                    <td>
                      <Link
                        to="/patients/$id"
                        params={{ id: String(a.patient_id) }}
                        className="font-bold text-ink hover:text-orange-600"
                      >
                        {patient ? `${patient.first_name} ${patient.last_name}` : `Patient #${a.patient_id}`}
                      </Link>
                      {patient && <p className="text-xs font-semibold text-ink-soft">{patient.phone_number}</p>}
                    </td>
                    <td className="font-semibold text-ink">{a.physician_name}</td>
                    <td className="col-md whitespace-nowrap text-ink-soft">{formatShortDateTime(a.scheduled_at)}</td>
                    <td className="col-xl font-semibold">{a.duration_minutes} min</td>
                    <td className="col-lg max-w-[220px] truncate text-ink-soft" title={a.reason || ''}>
                      {a.reason || '—'}
                    </td>
                    <td>
                      <StatusBadge status={a.status} />
                    </td>
                    <td>
                      {a.status === 'requested' ? (
                        <button
                          onClick={() => confirmAppointment(a.id)}
                          disabled={isPending}
                          className="clay-btn-green btn-sm"
                        >
                          <Icon name="checkCircle" className="h-4 w-4" />
                          {isPending && variables === a.id ? 'Confirming...' : 'Confirm'}
                        </button>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {list.length === 0 && <EmptyState icon="calendar" text="No appointments yet" />}
        </div>
        <Pagination paged={paged} noun="appointments" />
      </div>
    </div>
  )
}
