import { useState } from 'react'
import { useParams, Link } from '@tanstack/react-router'
import { usePatient, useInitiateCall } from '../hooks/usePatients'
import { useCalls } from '../hooks/useCalls'
import { useAppointments } from '../hooks/useAppointments'
import { Icon } from '../components/Icon'
import {
  StatusBadge,
  Loader,
  ErrorState,
  formatShortDateTime,
  callDuration,
} from '../components/ui'

export function PatientDetailPage() {
  const { id } = useParams({ strict: false }) as { id?: string }
  const patientId = Number(id)
  const { data: patient, isLoading, error } = usePatient(patientId)
  const { data: calls } = useCalls({ patient_id: patientId })
  const { data: appointments } = useAppointments({ patient_id: patientId })
  const { mutate: initiateCall, isPending } = useInitiateCall()
  const [callMessage, setCallMessage] = useState<{ ok: boolean; text: string } | null>(null)

  if (isLoading) return <Loader text="Loading patient profile..." />
  if (error || !patient) return <ErrorState text="Error loading patient" />

  const patientCalls = calls || []
  const patientAppointments = appointments || []
  const ini = `${patient.first_name?.[0] || ''}${patient.last_name?.[0] || ''}`

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
    <div className="flex flex-col gap-4">
      <div>
        <Link to="/patients" className="m-btn !min-h-[32px] !py-1 !px-3 !text-xs mb-2 inline-flex items-center gap-1.5">
          ← All patients
        </Link>
      </div>

      {/* Patient Hero Card */}
      <div className="m-card flex flex-wrap items-center gap-4">
        <span className="m-av !h-16 !w-16 !text-xl font-extrabold">{ini}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[22px] font-extrabold text-[#14212e]">
              {patient.first_name} {patient.last_name}
            </h1>
            <StatusBadge status={patient.status} />
          </div>
          <div className="mt-1 text-sm text-[#56646f]">
            {patient.mrn} · {patient.phone_number} · Preferred language: {patient.preferred_language || 'English'}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button onClick={startCall} disabled={isPending} className="m-btn-primary">
            <Icon name="phoneCall" className="h-4 w-4" />
            {isPending ? 'Calling...' : 'Call now'}
          </button>
        </div>
      </div>

      {callMessage && (
        <div
          className={`rounded-lg px-4 py-2.5 text-xs font-bold ${
            callMessage.ok ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          {callMessage.text}
        </div>
      )}

      {/* Row 2: 4 Meridian Info Cards */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="m-card">
          <div className="m-lbl dark:text-slate-400">Consulting doctor</div>
          <div className="mt-2.5 flex items-center gap-2.5">
            <span className="m-av !h-8 !w-8 text-xs font-bold">AR</span>
            <div>
              <div className="text-sm font-extrabold text-[#14212e] dark:text-white">Dr. Ananya Rao</div>
              <div className="text-xs text-[#56646f] dark:text-slate-400">General Physician</div>
            </div>
          </div>
        </div>

        <div className="m-card">
          <div className="m-lbl dark:text-slate-400">Chronic Condition</div>
          <div className="mt-2 text-[16px] font-extrabold text-[#14212e] dark:text-white">Type 2 Diabetes</div>
          <div className="text-xs text-[#56646f] dark:text-slate-300 mt-0.5">Severity: Moderate</div>
        </div>

        <div className="m-card">
          <div className="m-lbl dark:text-slate-400">Care plan schedule</div>
          <div className="mt-2 text-sm font-extrabold text-[#14212e] dark:text-white">Every 30 days</div>
          <div className="text-xs text-[#56646f] dark:text-slate-300 mt-0.5">Next call: In 7 days</div>
        </div>

        <div className="m-card">
          <div className="m-lbl dark:text-slate-400">Medication adherence</div>
          <div className="mt-2">
            <span className="m-pill m-pill-ok text-xs font-bold">Good / Adherent</span>
          </div>
          <div className="mt-1 text-xs text-[#56646f] dark:text-slate-300">From the latest check-in call</div>
        </div>
      </div>

      {/* Row 3: Call Log & Appointments */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Call Log */}
        <div className="m-card !p-0 overflow-hidden">
          <div className="border-b border-[#dbe3ea] bg-white px-5 py-3">
            <div className="text-[15px] font-extrabold text-[#14212e]">Call history</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#dbe3ea] bg-[#fafbfc] text-[11px] font-extrabold uppercase text-[#56646f]">
                  <th className="px-3.5 py-2">Date</th>
                  <th className="px-3.5 py-2">Direction</th>
                  <th className="px-3.5 py-2">Duration</th>
                  <th className="px-3.5 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eef2f5]">
                {patientCalls.length > 0 ? (
                  patientCalls.slice(0, 5).map((c) => (
                    <tr key={c.id} className="hover:bg-[#fafbfc]">
                      <td className="px-3.5 py-2.5 font-medium">{formatShortDateTime(c.created_at)}</td>
                      <td className="px-3.5 py-2.5 capitalize">{c.direction}</td>
                      <td className="px-3.5 py-2.5 text-[#56646f]">{callDuration(c.started_at, c.ended_at)}</td>
                      <td className="px-3.5 py-2.5">
                        <StatusBadge status={c.status} />
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-[#56646f]">No calls logged yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Appointments */}
        <div className="m-card !p-0 overflow-hidden">
          <div className="border-b border-[#dbe3ea] bg-white px-5 py-3">
            <div className="text-[15px] font-extrabold text-[#14212e]">Appointments</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#dbe3ea] bg-[#fafbfc] text-[11px] font-extrabold uppercase text-[#56646f]">
                  <th className="px-3.5 py-2">Doctor</th>
                  <th className="px-3.5 py-2">Scheduled</th>
                  <th className="px-3.5 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eef2f5]">
                {patientAppointments.length > 0 ? (
                  patientAppointments.map((a) => (
                    <tr key={a.id} className="hover:bg-[#fafbfc]">
                      <td className="px-3.5 py-2.5 font-bold text-[#14212e]">{a.doctor_name}</td>
                      <td className="px-3.5 py-2.5 text-[#56646f]">
                        {a.start_at ? formatShortDateTime(a.start_at) : 'Not scheduled'}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <StatusBadge status={a.status} />
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-[#56646f]">No appointments booked.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
