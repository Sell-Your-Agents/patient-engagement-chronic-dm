import { useEscalations, useUpdateEscalation } from '../hooks/useEscalations'
import { usePatients } from '../hooks/usePatients'
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Icon } from '../components/Icon'
import {
  PageHeader,
  StatCard,
  StatusBadge,
  SeverityBadge,
  Field,
  EmptyState,
  Loader,
  ErrorState,
  formatDate,
  paginate,
  Pagination,
} from '../components/ui'

const SEVERITY_BAR: Record<string, string> = {
  urgent: 'bg-rose-500',
  high: 'bg-orange-500',
  medium: 'bg-amber-400',
  low: 'bg-sky-400',
}

export function EscalationQueuePage() {
  const navigate = useNavigate()
  const { data: escalations, isLoading, error } = useEscalations()
  const { data: patients } = usePatients(0, 100)
  const { mutate: updateEscalation, isPending } = useUpdateEscalation()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [page, setPage] = useState(1)

  if (isLoading) return <Loader text="Loading escalations..." />
  if (error) return <ErrorState text="Error loading escalations" />

  const patientById = new Map(patients?.map((p) => [p.id, p]) || [])
  const patientName = (id: number) => {
    const p = patientById.get(id)
    return p ? `${p.first_name} ${p.last_name}` : `Patient #${id}`
  }

  const selected = escalations?.find((e) => e.id === selectedId)
  const openCases = escalations?.filter((e) => e.status === 'open') || []
  const urgentCases = openCases.filter((e) => e.severity === 'urgent')
  const paged = paginate(openCases, page, setPage, 5)

  return (
    <div>
      <PageHeader title="Escalation Queue" subtitle="Patient cases flagged by the AI agent that need care team attention." />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Open Cases" value={openCases.length} icon="alert" tint="coral" />
        <StatCard label="Urgent" value={urgentCases.length} icon="activity" tint="rose" />
        <StatCard label="Total" value={escalations?.length || 0} icon="shield" tint="sky" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* List */}
        <div className="space-y-3 xl:col-span-2">
          {paged.pageItems.map((escalation) => (
            <div
              key={escalation.id}
              onClick={() => setSelectedId(escalation.id)}
              className={`clay relative cursor-pointer overflow-hidden !rounded-[20px] p-4 pl-6 transition hover:-translate-y-0.5 ${
                selectedId === escalation.id ? 'ring-2 ring-orange-400' : ''
              }`}
            >
              <span className={`absolute inset-y-0 left-0 w-2 ${SEVERITY_BAR[escalation.severity] || 'bg-sky-400'}`} />
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-extrabold text-ink">{patientName(escalation.patient_id)}</p>
                  <p className="mt-1 line-clamp-2 text-sm text-ink-soft">{escalation.reason}</p>
                </div>
                <SeverityBadge severity={escalation.severity} />
              </div>
              <div className="mt-3 flex items-center gap-4 text-xs font-semibold text-ink-muted">
                <span className="flex items-center gap-1">
                  <Icon name="clock" className="h-3.5 w-3.5" /> Created {formatDate(escalation.created_at)}
                </span>
                <span>Call #{escalation.outreach_call_id}</span>
              </div>
            </div>
          ))}
          {openCases.length === 0 && (
            <div className="clay">
              <EmptyState icon="checkCircle" text="No open escalations" />
            </div>
          )}
          {openCases.length > 0 && (
            <div className="clay overflow-hidden">
              <Pagination paged={paged} noun="cases" />
            </div>
          )}
        </div>

        {/* Detail */}
        <div className="clay h-fit p-5 xl:sticky xl:top-8">
          {selected ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="card-title">Escalation #{selected.id}</h3>
                <SeverityBadge severity={selected.severity} />
              </div>

              <div className="clay-inset grid gap-3.5 rounded-[18px] p-4">
                <Field label="Patient">{patientName(selected.patient_id)}</Field>
                <Field label="Status">
                  <StatusBadge status={selected.status} />
                </Field>
                <Field label="Reason">
                  <span className="font-medium text-ink-soft">{selected.reason}</span>
                </Field>
              </div>

              <div className="space-y-3">
                <button
                  onClick={() => updateEscalation({ id: selected.id, status: 'acknowledged' })}
                  disabled={isPending}
                  className="clay-btn-blue w-full"
                >
                  <Icon name="clock" className="h-4 w-4" /> Acknowledge
                </button>
                <button
                  onClick={() =>
                    updateEscalation({
                      id: selected.id,
                      status: 'resolved',
                      resolution_notes: 'Resolved by care team',
                    })
                  }
                  disabled={isPending}
                  className="clay-btn-green w-full"
                >
                  <Icon name="checkCircle" className="h-4 w-4" /> Mark Resolved
                </button>
                <button
                  onClick={() => navigate({ to: '/escalations/$id', params: { id: String(selected.id) } })}
                  className="clay-btn-ghost w-full"
                >
                  Open Full Details <Icon name="chevronRight" className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : (
            <EmptyState icon="alert" text="Select an escalation to view details" />
          )}
        </div>
      </div>
    </div>
  )
}
