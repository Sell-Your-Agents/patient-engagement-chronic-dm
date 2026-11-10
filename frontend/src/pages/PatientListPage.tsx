import { usePatients, useInitiateCall } from '../hooks/usePatients'
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Icon } from '../components/Icon'
import { PageHeader, StatusBadge, EmptyState, Loader, ErrorState, paginate, Pagination } from '../components/ui'

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

  const totalPatients = patients?.length || 0
  const query = search.trim().toLowerCase()
  const filtered =
    patients?.filter(
      (p) =>
        !query ||
        `${p.first_name} ${p.last_name}`.toLowerCase().includes(query) ||
        p.mrn.toLowerCase().includes(query) ||
        p.phone_number.includes(query)
    ) || []
  const paged = paginate(filtered, page, setPage, 8)

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
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Patients"
        subtitle={`${totalPatients} enrolled patients · click View to open a patient dashboard`}
        actions={
          <div className="relative w-64">
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8fa1b3]" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              placeholder="Search patient, MRN or phone"
              className="w-full rounded-[10px] border border-[#cdd7df] bg-white py-2 pl-9 pr-3 text-sm text-[#14212e] outline-none transition focus:border-[#0f8f87]"
            />
          </div>
        }
      />

      {callMessage && (
        <div
          className={`rounded-lg px-4 py-2.5 text-xs font-bold ${
            callMessage.ok ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          {callMessage.text}
        </div>
      )}

      {/* Patient Table - Meridian style */}
      <div className="m-card !p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-[#dbe3ea] bg-[#fafbfc] text-[11.5px] font-extrabold uppercase tracking-[0.06em] text-[#56646f]">
                <th className="px-4 py-2.5">Patient</th>
                <th className="px-4 py-2.5">MRN & Phone</th>
                <th className="px-4 py-2.5">Language</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#eef2f5] text-[13.5px]">
              {paged.items.length > 0 ? (
                paged.items.map((p) => {
                  const ini = `${p.first_name?.[0] || ''}${p.last_name?.[0] || ''}`
                  const isThisCalling = isInitiating && callingPatientId === p.id
                  return (
                    <tr key={p.id} className="hover:bg-[#fafbfc] transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="m-av font-bold">{ini}</span>
                          <div>
                            <button
                              onClick={() => navigate({ to: '/patients/$id', params: { id: String(p.id) } })}
                              className="font-bold text-[#14212e] hover:text-[#0b6f6a] text-left"
                            >
                              {p.first_name} {p.last_name}
                            </button>
                            <div className="text-xs text-[#56646f]">{p.phone_number}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-[#56646f] font-mono">{p.mrn}</td>
                      <td className="px-4 py-3 text-xs capitalize text-[#14212e]">
                        {p.preferred_language || 'English'}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={p.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => startCall(p.id)}
                            disabled={isThisCalling}
                            className="m-btn !min-h-[32px] !py-1 !px-2.5 !text-xs"
                            title="Call Patient"
                          >
                            <Icon name="phoneCall" className="h-3.5 w-3.5" />
                            {isThisCalling ? 'Calling...' : 'Call'}
                          </button>
                          <button
                            onClick={() => navigate({ to: '/patients/$id', params: { id: String(p.id) } })}
                            className="m-btn !min-h-[32px] !py-1 !px-3 !text-xs !bg-[#14212e] !border-[#14212e] !text-white hover:!bg-[#0f8f87] hover:!border-[#0f8f87]"
                          >
                            View
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={5} className="py-8">
                    <EmptyState icon="users" text="No patients found matching your search." />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={paged.page}
          totalPages={paged.totalPages}
          setPage={paged.setPage}
          totalItems={paged.totalItems}
        />
      </div>
    </div>
  )
}
