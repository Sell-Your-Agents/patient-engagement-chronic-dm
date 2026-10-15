import { useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { useEscalation, useUpdateEscalation } from '../hooks/useEscalations'
import { usePatient } from '../hooks/usePatients'
import { Icon } from '../components/Icon'
import {
  PageHeader,
  StatusBadge,
  SeverityBadge,
  Field,
  Loader,
  ErrorState,
  formatDateTime,
} from '../components/ui'

export function EscalationDetailPage() {
  const { id } = useParams({ strict: false }) as { id?: string }
  const escalationId = Number(id)
  const { data: escalation, isLoading, error } = useEscalation(escalationId)
  const { data: patient } = usePatient(escalation?.patient_id ?? 0)
  const { mutate: updateEscalation, isPending } = useUpdateEscalation()
  const [notes, setNotes] = useState('')

  if (isLoading) return <Loader text="Loading escalation..." />
  if (error || !escalation) return <ErrorState text="Error loading escalation" />

  const patientName = patient ? `${patient.first_name} ${patient.last_name}` : `Patient #${escalation.patient_id}`

  return (
    <div>
      <PageHeader
        back={{ to: '/escalations', label: 'Back to Escalations' }}
        title={`Escalation #${escalation.id}`}
        subtitle={`Raised during outreach call #${escalation.outreach_call_id}`}
        actions={<SeverityBadge severity={escalation.severity} />}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="clay p-5 xl:col-span-2">
          <p className="card-title">Case Details</p>
          <div className="clay-inset mt-4 grid grid-cols-1 gap-4 rounded-[18px] p-4 sm:grid-cols-2">
            <Field label="Patient">
              {patient ? (
                <Link
                  to="/patients/$id"
                  params={{ id: String(patient.id) }}
                  className="text-orange-600 hover:underline"
                >
                  {patientName}
                </Link>
              ) : (
                patientName
              )}
            </Field>
            <Field label="Status">
              <StatusBadge status={escalation.status} />
            </Field>
            <Field label="Created">{formatDateTime(escalation.created_at)}</Field>
            <Field label="Acknowledged">{formatDateTime(escalation.acknowledged_at)}</Field>
            <Field label="Resolved">{formatDateTime(escalation.resolved_at)}</Field>
            <Field label="Assigned To">
              {escalation.assigned_to_user_id ? `User #${escalation.assigned_to_user_id}` : '—'}
            </Field>
          </div>

          <div className="mt-6">
            <p className="text-xs font-bold uppercase tracking-wider text-ink-muted">Reason</p>
            <p className="mt-2 leading-relaxed text-ink-soft">{escalation.reason}</p>
          </div>

          {escalation.resolution_notes && (
            <div className="mt-6">
              <p className="text-xs font-bold uppercase tracking-wider text-ink-muted">Resolution Notes</p>
              <p className="mt-2 leading-relaxed text-ink-soft">{escalation.resolution_notes}</p>
            </div>
          )}
        </div>

        <div className="clay h-fit space-y-4 p-5">
          <p className="card-title">Actions</p>
          <button
            onClick={() => updateEscalation({ id: escalation.id, status: 'acknowledged' })}
            disabled={isPending || escalation.status !== 'open'}
            className="clay-btn-blue w-full"
          >
            <Icon name="clock" className="h-4 w-4" /> Acknowledge
          </button>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Resolution notes (optional)"
            rows={4}
            className="clay-input resize-none"
          />
          <button
            onClick={() =>
              updateEscalation({
                id: escalation.id,
                status: 'resolved',
                resolution_notes: notes.trim() || 'Resolved by care team',
              })
            }
            disabled={isPending || escalation.status === 'resolved'}
            className="clay-btn-green w-full"
          >
            <Icon name="checkCircle" className="h-4 w-4" /> Mark Resolved
          </button>
        </div>
      </div>
    </div>
  )
}
