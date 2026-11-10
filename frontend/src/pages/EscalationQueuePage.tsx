import { useEscalations, useUpdateEscalation } from '../hooks/useEscalations'
import { usePatients } from '../hooks/usePatients'
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  PageHeader,
  StatusBadge,
  EmptyState,
  Loader,
  ErrorState,
  formatDate,
  paginate,
  Pagination,
} from '../components/ui'

export function EscalationQueuePage() {
  const navigate = useNavigate()
  const { data: escalations, isLoading, error } = useEscalations()
  const { data: patients } = usePatients(0, 100)
  const { mutate: updateEscalation, isPending } = useUpdateEscalation()
  const [page, setPage] = useState(1)

  if (isLoading) return <Loader text="Loading escalations..." />
  if (error) return <ErrorState text="Error loading escalations" />

  const patientById = new Map(patients?.map((p) => [p.id, p]) || [])
  const patientName = (id: number | null) => {
    if (id === null) return 'Unknown caller'
    const p = patientById.get(id)
    return p ? `${p.first_name} ${p.last_name}` : `Patient #${id}`
  }

  const openCases = escalations?.filter((e) => e.status !== 'resolved') || []
  const urgentCases = openCases.filter((e) => e.severity === 'urgent')
  const paged = paginate(escalations || [], page, setPage, 6)

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Escalations"
        subtitle="Patient cases flagged by the AI agent that need care team attention."
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <div className="m-card">
          <div className="m-lbl">Open Cases</div>
          <div className="mt-1.5 text-[28px] font-extrabold text-[#a11d27]">{openCases.length}</div>
          <div className="mt-1 text-xs text-[#56646f]">Require action</div>
        </div>
        <div className="m-card">
          <div className="m-lbl">Urgent Cases</div>
          <div className="mt-1.5 text-[28px] font-extrabold text-[#a11d27]">{urgentCases.length}</div>
          <div className="mt-1 text-xs text-[#56646f]">High priority triage</div>
        </div>
        <div className="m-card">
          <div className="m-lbl">Total Logged</div>
          <div className="mt-1.5 text-[28px] font-extrabold text-[#14212e]">{escalations?.length || 0}</div>
          <div className="mt-1 text-xs text-[#56646f]">Historical cases</div>
        </div>
      </div>

      {/* Meridian List Layout */}
      <div className="flex flex-col gap-3">
        {paged.items.map((e) => {
          const isUrgent = e.severity === 'urgent'
          const isHigh = e.severity === 'high'
          const sevCls = isUrgent ? 'm-pill-bad' : isHigh ? 'm-pill-warn' : 'm-pill-info'
          const canAck = e.status === 'open'
          const canRes = e.status !== 'resolved'

          return (
            <div
              key={e.id}
              className="m-card flex flex-wrap items-center justify-between gap-3 transition hover:border-[#0f8f87]"
            >
              <span className={`m-pill uppercase font-bold text-xs ${sevCls}`}>{e.severity}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-extrabold text-[#14212e]">
                  {patientName(e.patient_id)}
                </div>
                <div className="text-[13.5px] text-[#56646f]">{e.reason}</div>
                <div className="mt-1 text-xs text-[#8fa1b3]">
                  Escalation #{e.id} · raised in call #{e.call_log_id} · {formatDate(e.created_at)}
                </div>
              </div>
              <StatusBadge status={e.status} />
              <div className="flex items-center gap-2">
                {canAck && (
                  <button
                    onClick={() => updateEscalation({ id: e.id, status: 'acknowledged' })}
                    disabled={isPending}
                    className="m-btn !min-h-[34px] !py-1 !px-3 !text-xs"
                  >
                    Acknowledge
                  </button>
                )}
                {canRes && (
                  <button
                    onClick={() =>
                      updateEscalation({
                        id: e.id,
                        status: 'resolved',
                        resolution_notes: 'Resolved by care team',
                      })
                    }
                    disabled={isPending}
                    className="m-btn-primary !min-h-[34px] !py-1 !px-3 !text-xs"
                  >
                    Resolve
                  </button>
                )}
                {e.patient_id && (
                  <button
                    onClick={() => navigate({ to: '/patients/$id', params: { id: String(e.patient_id) } })}
                    className="m-btn !min-h-[34px] !py-1 !px-3 !text-xs !bg-[#14212e] !border-[#14212e] !text-white hover:!bg-[#0f8f87] hover:!border-[#0f8f87]"
                  >
                    View Patient
                  </button>
                )}
              </div>
            </div>
          )
        })}

        {paged.items.length === 0 && (
          <div className="m-card">
            <EmptyState icon="checkCircle" text="No escalations in queue." />
          </div>
        )}

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
