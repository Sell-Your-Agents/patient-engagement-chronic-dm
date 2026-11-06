import { usePatients, useInitiateCall } from '../hooks/usePatients'
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Icon } from '../components/Icon'
import { PageHeader, StatCard, StatusBadge, EmptyState, Loader, ErrorState, paginate, Pagination } from '../components/ui'

export function PatientListPage() {
  const { data: patients, isLoading, error } = usePatients(0, 100)
  const { mutate: initiateCall, isPending: isInitiating } = useInitiateCall()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [callMessage, setCallMessage] = useState<{ patientId: number; ok: boolean; text: string } | null>(null)
  const [callingPatientId, setCallingPatientId] = useState<number | null>(null)

  if (isLoading) return <Loader text="Loading patients..." />
  if (error) return <ErrorState text="Error loading patients" />

  const activePatients = patients?.filter((p) => p.status === 'active') || []
  const query = search.trim().toLowerCase()
  const filtered =
    patients?.filter(
      (p) =>
        !query ||
        `${p.first_name} ${p.last_name}`.toLowerCase().includes(query) ||
        p.mrn.toLowerCase().includes(query) ||
        p.phone_number.includes(query)
    ) || []
  const paged = paginate(filtered, page, setPage, 7)

  const startCall = (patientId: number) => {
    setCallMessage(null)
    setCallingPatientId(patientId)
    initiateCall(
      { patient_id: patientId },
      {
        onSuccess: () => setCallMessage({ patientId, ok: true, text: 'Call initiated' }),
        onError: (err: any) =>
          setCallMessage({ patientId, ok: false, text: err?.response?.data?.detail || 'Failed to initiate call' }),
        onSettled: () => setCallingPatientId(null),
      }
    )
  }

  return (
    <div>
      <PageHeader title="Patients" subtitle="Manage enrolled patients and start outreach calls." />

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard label="Total Patients" value={patients?.length || 0} icon="users" tint="peach" />
        <StatCard label="Active" value={activePatients.length} icon="activity" tint="mint" />
      </div>

      {/* Patient List */}
      <div className="clay mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="card-title">All Patients</p>
          <div className="relative w-full sm:w-72">
            <Icon name="search" className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              placeholder="Search name, MRN or phone"
              className="clay-input !py-2.5 !pl-10"
            />
          </div>
        </div>
        <div>
          <table className="clay-table w-full">
            <thead>
              <tr>
                <th>Name</th>
                <th className="col-lg">MRN</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {paged.pageItems.map((patient) => (
                <tr key={patient.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-100 text-xs font-extrabold text-orange-600">
                        {patient.first_name.charAt(0)}
                        {patient.last_name.charAt(0)}
                      </span>
                      <span className="font-bold text-ink">
                        {patient.first_name} {patient.last_name}
                      </span>
                    </div>
                  </td>
                  <td className="col-lg font-mono text-ink-soft">{patient.mrn}</td>
                  <td className="font-semibold text-ink">{patient.phone_number}</td>
                  <td>
                    <StatusBadge status={patient.status} />
                  </td>
                  <td>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => startCall(patient.id)}
                        disabled={isInitiating}
                        title="Call patient"
                        className="clay-btn btn-sm"
                      >
                        <Icon name="phoneCall" className="h-4 w-4" />
                        {callingPatientId === patient.id ? 'Calling...' : 'Call'}
                      </button>
                      <button
                        onClick={() => navigate({ to: '/patients/$id', params: { id: String(patient.id) } })}
                        className="clay-btn-ghost btn-sm"
                      >
                        View <Icon name="chevronRight" className="h-4 w-4" />
                      </button>
                      {callMessage?.patientId === patient.id && (
                        <span className={`text-xs font-semibold ${callMessage.ok ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {callMessage.text}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <EmptyState icon="users" text="No patients found" />}
        </div>
        <Pagination paged={paged} noun="patients" />
      </div>
    </div>
  )
}
