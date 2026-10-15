import { useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { usePatient, useInitiateCall } from '../hooks/usePatients'
import { useOutreachCalls } from '../hooks/useOutreachCalls'
import { useAppointments } from '../hooks/useAppointments'
import { Icon } from '../components/Icon'
import {
  PageHeader,
  StatusBadge,
  Field,
  EmptyState,
  Loader,
  ErrorState,
  formatShortDateTime,
  callDuration,
  paginate,
  Pagination,
} from '../components/ui'

export function PatientDetailPage() {
  const { id } = useParams({ strict: false }) as { id?: string }
  const patientId = Number(id)
  const { data: patient, isLoading, error } = usePatient(patientId)
  const { data: calls } = useOutreachCalls(patientId)
  const { data: appointments } = useAppointments()
  const { mutate: initiateCall, isPending } = useInitiateCall()
  const [callMessage, setCallMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [callPage, setCallPage] = useState(1)

  if (isLoading) return <Loader text="Loading patient..." />
  if (error || !patient) return <ErrorState text="Error loading patient" />

  const patientAppointments = appointments?.filter((a) => a.patient_id === patientId) || []
  const pagedCalls = paginate(calls || [], callPage, setCallPage, 5)

  const startCall = () => {
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
      <PageHeader
        back={{ to: '/patients', label: 'Back to Patients' }}
        title={`${patient.first_name} ${patient.last_name}`}
        subtitle="Patient profile, call history and appointments."
        actions={
          <button onClick={startCall} disabled={isPending} className="clay-btn">
            <Icon name="phoneCall" className="h-4 w-4" />
            {isPending ? 'Calling...' : 'Initiate Call'}
          </button>
        }
      />
      {callMessage && (
        <p className={`-mt-3 mb-4 text-sm font-semibold ${callMessage.ok ? 'text-emerald-600' : 'text-rose-600'}`}>
          {callMessage.text}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Profile + appointments */}
        <div className="h-fit">
          <div className="clay p-5">
            <div className="flex items-center gap-4">
              <span className="logo-mark h-14 w-14 !rounded-full text-lg font-extrabold text-white">
                {patient.first_name.charAt(0)}
                {patient.last_name.charAt(0)}
              </span>
              <div>
                <p className="card-title">
                  {patient.first_name} {patient.last_name}
                </p>
                <StatusBadge status={patient.status} />
              </div>
            </div>
            <div className="clay-inset mt-4 grid gap-3 rounded-[18px] p-4">
              <Field label="MRN">
                <span className="font-mono">{patient.mrn}</span>
              </Field>
              <Field label="Phone">{patient.phone_number}</Field>
              <Field label="Preferred Language">
                <span className="uppercase">{patient.preferred_language}</span>
              </Field>
            </div>
          </div>

            {/* Appointments */}
            <div className="clay mt-4 overflow-hidden">
              <p className="card-title px-5 pb-2 pt-4">Appointments</p>
              {patientAppointments.length === 0 ? (
                <p className="px-5 pb-4 text-sm text-ink-muted">No appointments for this patient</p>
              ) : (
                <div className="space-y-2 px-4 pb-4">
                  {patientAppointments.slice(0, 3).map((a) => (
                    <div key={a.id} className="clay-inset rounded-2xl px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-bold text-ink">{a.physician_name}</p>
                        <StatusBadge status={a.status} />
                      </div>
                      <p className="mt-0.5 text-xs text-ink-soft">{formatShortDateTime(a.scheduled_at)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
        </div>

        {/* Call history */}
        <div className="clay overflow-hidden xl:col-span-2">
          <p className="card-title px-5 pb-3 pt-4">Call History</p>
          <div>
            <table className="clay-table w-full">
              <thead>
                <tr>
                  <th>Call</th>
                  <th>Date & Time</th>
                  <th className="col-md">Duration</th>
                  <th>Status</th>
                  <th className="col-xl">Flags</th>
                </tr>
              </thead>
              <tbody>
                {pagedCalls.pageItems.map((call) => (
                  <tr key={call.id}>
                    <td className="font-bold text-ink">#{call.id}</td>
                    <td className="whitespace-nowrap text-ink-soft">{formatShortDateTime(call.started_at)}</td>
                    <td className="col-md font-semibold">{callDuration(call.started_at, call.ended_at)}</td>
                    <td>
                      <StatusBadge status={call.status} />
                    </td>
                    <td className="col-xl">
                      <div className="flex flex-wrap gap-2">
                        {call.warning_signs_detected && (
                          <span className="pill bg-rose-100 text-rose-700">
                            <Icon name="alert" className="h-3.5 w-3.5" /> Warning
                          </span>
                        )}
                        {call.csat_score && (
                          <span className="pill bg-amber-100 text-amber-700">
                            <Icon name="star" className="h-3.5 w-3.5" /> {call.csat_score}/5
                          </span>
                        )}
                        {!call.warning_signs_detected && !call.csat_score && <span className="text-ink-muted">—</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(!calls || calls.length === 0) && <EmptyState icon="phone" text="No calls yet for this patient" />}
          </div>
          <Pagination paged={pagedCalls} noun="calls" />
        </div>
      </div>

    </div>
  )
}
