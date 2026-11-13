import { useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { useEscalation, useUpdateEscalation } from '../hooks/useEscalations'
import { usePatient } from '../hooks/usePatients'
import { useCalls } from '../hooks/useCalls'
import { useClinicInfo } from '../hooks/useClinic'
import { Icon } from '../components/Icon'
import { toast, errorText } from '../components/toast'
import { PageHeader, Panel, StatusBadge, SeverityBadge, Loader, ErrorState, Spinner, Avatar, friendlyTime } from '../components/ui'
import { TranscriptView } from '../components/clinic'

export function EscalationDetailPage() {
  const { id } = useParams({ strict: false }) as { id?: string }
  const escalationId = Number(id)
  const { data: e, isLoading, error, refetch } = useEscalation(escalationId)
  const { data: patient } = usePatient(e?.patient_id ?? 0)
  const { data: calls } = useCalls()
  const { data: info } = useClinicInfo()
  const { mutate, isPending } = useUpdateEscalation()
  const [notes, setNotes] = useState('')

  if (isLoading) return <Loader text="Loading escalation…" variant="detail" />
  if (error || !e) return <ErrorState text="Could not load this escalation" onRetry={() => refetch()} />

  const done = (msg: string) => ({
    onSuccess: () => toast.success(msg, `Escalation ${e.id}`),
    onError: (err: unknown) => toast.error('Could not update escalation', errorText(err, 'Please try again.')),
  })
  const name = patient ? `${patient.first_name} ${patient.last_name}` : e.patient_id === null ? 'New caller' : `Patient ${e.patient_id}`
  const call = (calls || []).find((c) => c.id === e.call_log_id)

  return (
    <div>
      <PageHeader title={`Escalation ${e.id}`} back={{ to: '/escalations', label: 'All escalations' }} subtitle={`Raised in call ${e.call_log_id}`} />

      <div className="grid gap-3.5 xl:grid-cols-3">
        <div className="space-y-3.5 xl:col-span-2">
          <div className="card flex flex-wrap items-center gap-4 p-5">
            <Avatar name={name} size={52} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-black">{name}</h2>
                <SeverityBadge severity={e.severity} />
                <StatusBadge status={e.status} />
              </div>
              <p className="mt-1 text-[15px] text-ink-soft">{e.reason}</p>
            </div>
            {patient && (
              <Link to="/patients/$id" params={{ id: String(patient.id) }} className="btn">
                Open patient
              </Link>
            )}
          </div>

          <div className="kv">
            <div>
              <div className="lbl">Raised</div>
              <b>{friendlyTime(e.created_at, true)}</b>
            </div>
            <div>
              <div className="lbl">Acknowledged</div>
              <b>{e.acknowledged_at ? friendlyTime(e.acknowledged_at, true) : '—'}</b>
            </div>
            <div>
              <div className="lbl">Resolved</div>
              <b>{e.resolved_at ? friendlyTime(e.resolved_at, true) : '—'}</b>
            </div>
          </div>

          {call?.summary && (
            <Panel title="What the agent recorded">
              <p className="note mx-[18px] mb-[18px]">{call.summary}</p>
            </Panel>
          )}
          {call?.transcript && (
            <Panel title="Conversation" subtitle={`Call ${call.id}`}>
              <div className="px-[18px] pb-[18px]">
                <TranscriptView transcript={call.transcript} agentName={info?.agent_name || 'Agent'} />
              </div>
            </Panel>
          )}
        </div>

        <Panel title="Actions" className="h-fit">
          <div className="space-y-3 px-[18px] pb-[18px]">
            {e.status === 'resolved' ? (
              <p className="okbox">This escalation is resolved.{e.resolution_notes ? ` ${e.resolution_notes}` : ''}</p>
            ) : (
              <>
                <button className="btn w-full" disabled={isPending || e.status !== 'open'} onClick={() => mutate({ id: e.id, status: 'acknowledged' }, done('Escalation acknowledged'))}>
                  <Icon name="clock" className="h-4 w-4" /> Acknowledge
                </button>
                <textarea className="field" rows={4} value={notes} onChange={(ev) => setNotes(ev.target.value)} placeholder="Resolution notes (optional)" />
                <button
                  className="btn p w-full"
                  disabled={isPending}
                  onClick={() => mutate({ id: e.id, status: 'resolved', resolution_notes: notes.trim() || 'Resolved by care team' }, done('Escalation resolved'))}
                >
                  {isPending ? <Spinner /> : <Icon name="checkCircle" className="h-4 w-4" />} Mark resolved
                </button>
              </>
            )}
          </div>
        </Panel>
      </div>
    </div>
  )
}
