import { usePatients, useInitiateCall, useUpdatePatient } from '../hooks/usePatients'
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Icon } from '../components/Icon'
import { PageHeader, StatCard, StatusBadge, Field, EmptyState, Loader, ErrorState, paginate, Pagination } from '../components/ui'

const LANGUAGES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  zh: 'Mandarin',
}

export function PatientListPage() {
  const { data: patients, isLoading, error } = usePatients(0, 100)
  const { mutate: initiateCall, isPending: isInitiating } = useInitiateCall()
  const { mutate: updatePatient, isPending: isUpdating } = useUpdatePatient()
  const navigate = useNavigate()
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [formData, setFormData] = useState<any>({})
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [callMessage, setCallMessage] = useState<{ ok: boolean; text: string } | null>(null)

  if (isLoading) return <Loader text="Loading patients..." />
  if (error) return <ErrorState text="Error loading patients" />

  const selected = patients?.find((p) => p.id === selectedPatientId)
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

  const selectPatient = (id: number) => {
    setSelectedPatientId(id)
    setIsEditing(false)
    setCallMessage(null)
  }

  const startCall = (patientId: number) => {
    setCallMessage(null)
    initiateCall(
      { patient_id: patientId },
      {
        onSuccess: () => setCallMessage({ ok: true, text: 'Call initiated successfully' }),
        onError: (err: any) =>
          setCallMessage({ ok: false, text: err?.response?.data?.detail || 'Failed to initiate call' }),
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

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Patient List */}
        <div className="clay overflow-hidden xl:col-span-2">
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
                  <tr
                    key={patient.id}
                    onClick={() => selectPatient(patient.id)}
                    className={`cursor-pointer ${selectedPatientId === patient.id ? 'row-selected' : ''}`}
                  >
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
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          navigate({ to: '/patients/$id', params: { id: String(patient.id) } })
                        }}
                        className="clay-btn-ghost btn-sm"
                      >
                        View <Icon name="chevronRight" className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && <EmptyState icon="users" text="No patients found" />}
          </div>
          <Pagination paged={paged} noun="patients" />
        </div>

        {/* Quick Actions */}
        <div className="clay h-fit p-5 xl:sticky xl:top-8">
          {selected ? (
            <div className="space-y-4">
              {!isEditing ? (
                <>
                  <div className="flex items-center gap-3">
                    <span className="logo-mark h-12 w-12 !rounded-full text-base font-extrabold text-white">
                      {selected.first_name.charAt(0)}
                      {selected.last_name.charAt(0)}
                    </span>
                    <div>
                      <h3 className="card-title">
                        {selected.first_name} {selected.last_name}
                      </h3>
                      <StatusBadge status={selected.status} />
                    </div>
                  </div>

                  <div className="clay-inset grid grid-cols-1 gap-3.5 rounded-[18px] p-4">
                    <Field label="MRN">
                      <span className="font-mono">{selected.mrn}</span>
                    </Field>
                    <Field label="Phone">{selected.phone_number}</Field>
                    <Field label="Language">
                      {LANGUAGES[selected.preferred_language] || selected.preferred_language}
                    </Field>
                  </div>

                  <button
                    onClick={() => startCall(selected.id)}
                    disabled={isInitiating}
                    className="clay-btn w-full"
                  >
                    <Icon name="phoneCall" className="h-4 w-4" />
                    {isInitiating ? 'Calling...' : 'Initiate Call'}
                  </button>
                  {callMessage && (
                    <p className={`text-center text-sm font-semibold ${callMessage.ok ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {callMessage.text}
                    </p>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => {
                        setFormData({
                          first_name: selected.first_name,
                          last_name: selected.last_name,
                          phone_number: selected.phone_number,
                          preferred_language: selected.preferred_language,
                          status: selected.status,
                        })
                        setIsEditing(true)
                      }}
                      className="clay-btn-ghost text-sm"
                    >
                      <Icon name="edit" className="h-4 w-4" /> Edit
                    </button>
                    <button
                      onClick={() => navigate({ to: '/patients/$id', params: { id: String(selected.id) } })}
                      className="clay-btn-ghost text-sm"
                    >
                      <Icon name="user" className="h-4 w-4" /> Profile
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h3 className="card-title">Edit Patient</h3>

                  <input
                    type="text"
                    placeholder="First Name"
                    value={formData.first_name || ''}
                    onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                    className="clay-input"
                  />

                  <input
                    type="text"
                    placeholder="Last Name"
                    value={formData.last_name || ''}
                    onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                    className="clay-input"
                  />

                  <input
                    type="tel"
                    placeholder="Phone Number"
                    value={formData.phone_number || ''}
                    onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
                    className="clay-input"
                  />

                  <select
                    value={formData.preferred_language || ''}
                    onChange={(e) => setFormData({ ...formData, preferred_language: e.target.value })}
                    className="clay-input"
                  >
                    {Object.entries(LANGUAGES).map(([code, label]) => (
                      <option key={code} value={code}>
                        {label}
                      </option>
                    ))}
                  </select>

                  <select
                    value={formData.status || ''}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    className="clay-input"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="discharged">Discharged</option>
                  </select>

                  <button
                    onClick={() => {
                      updatePatient(
                        { id: selected.id, updates: formData },
                        {
                          onSuccess: () => {
                            setIsEditing(false)
                          },
                        }
                      )
                    }}
                    disabled={isUpdating}
                    className="clay-btn-green w-full"
                  >
                    {isUpdating ? 'Saving...' : 'Save Changes'}
                  </button>

                  <button onClick={() => setIsEditing(false)} className="clay-btn-ghost w-full">
                    Cancel
                  </button>
                </>
              )}
            </div>
          ) : (
            <EmptyState icon="user" text="Select a patient to view details" />
          )}
        </div>
      </div>
    </div>
  )
}
