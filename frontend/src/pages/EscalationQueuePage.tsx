import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useEscalations, useUpdateEscalation, type Escalation } from '../hooks/useEscalations'
import { usePatients } from '../hooks/usePatients'
import { useCalls } from '../hooks/useCalls'
import { Icon } from '../components/Icon'
import { PageHeader, Kpi, StatusBadge, SeverityBadge, EmptyState, Loader, ErrorState, Spinner, Drawer, friendlyTime, utcDate, paginate, Pagination } from '../components/ui'
import { toast, errorText } from '../components/toast'

type Filter = 'active' | 'open' | 'acknowledged' | 'resolved' | 'all'
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'active', label: 'Needs action' },
  { key: 'open', label: 'Open' },
  { key: 'acknowledged', label: 'Acknowledged' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'all', label: 'All' },
]
const ORDER: Record<string, number> = { urgent: 0, critical: 0, high: 1, medium: 2, low: 3 }
const EDGE: Record<string, string> = { urgent: 'var(--bad)', critical: 'var(--bad)', high: 'var(--warn)', medium: 'var(--info)', low: 'var(--mute)' }
const matches = (e: Escalation, f: Filter) => (f === 'all' ? true : f === 'active' ? e.status !== 'resolved' : e.status === f)

export function EscalationQueuePage() {
  const navigate = useNavigate()
  const { data: escalations, isLoading, error, refetch } = useEscalations()
  const { data: patients } = usePatients(0, 100)
  const { data: calls } = useCalls()
  const { mutate } = useUpdateEscalation()
  const [filter, setFilter] = useState<Filter>('active')
  const [busy, setBusy] = useState<{ id: number; action: string } | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [notes, setNotes] = useState('')
  const [page, setPage] = useState(1)

  if (isLoading) return <Loader text="Loading escalations…" variant="list" />
  if (error) return <ErrorState text="Could not load escalations" onRetry={() => refetch()} />

  const all = escalations || []
  const nameOf = (id: number | null) => {
    if (id === null) return 'New caller'
    const p = patients?.find((x) => x.id === id)
    return p ? `${p.first_name} ${p.last_name}` : `Patient ${id}`
  }
  const list = all
    .filter((e) => matches(e, filter))
    .sort((a, b) => Number(a.status === 'resolved') - Number(b.status === 'resolved') || (ORDER[a.severity] ?? 9) - (ORDER[b.severity] ?? 9) || b.created_at.localeCompare(a.created_at))
  const paged = paginate(list, page, setPage, 10)

  const open = all.filter((e) => e.status === 'open')
  const ack = all.filter((e) => e.status === 'acknowledged')
  const urgent = all.filter((e) => e.status !== 'resolved' && e.severity === 'urgent')
  const ackTimes = all.filter((e) => e.acknowledged_at).map((e) => (utcDate(e.acknowledged_at!).getTime() - utcDate(e.created_at).getTime()) / 60000).sort((a, b) => a - b)
  const median = ackTimes.length ? ackTimes[Math.floor(ackTimes.length / 2)]! : null
  const medianLabel = median == null ? '—' : median < 60 ? `${Math.round(median)} min` : `${(median / 60).toFixed(1)} h`

  const act = (e: Escalation, status: 'acknowledged' | 'resolved', resolution?: string) => {
    setBusy({ id: e.id, action: status })
    mutate(
      { id: e.id, status, ...(status === 'resolved' ? { resolution_notes: resolution || 'Resolved by care team' } : {}) },
      {
        onSuccess: () => {
          if (status === 'resolved') {
            toast.success('Escalation resolved', `Escalation ${e.id} · ${nameOf(e.patient_id)}`)
            setSelected(null)
            setNotes('')
          } else toast.info('Escalation acknowledged', `Escalation ${e.id} · ${nameOf(e.patient_id)}`)
        },
        onError: (err) => toast.error('Could not update escalation', errorText(err, 'Please try again.')),
        onSettled: () => setBusy(null),
      },
    )
  }

  const sel = all.find((e) => e.id === selected)
  const selCall = sel ? (calls || []).find((c) => c.id === sel.call_log_id) : undefined

  return (
    <div>
      <PageHeader title="Escalations" />

      <div className="grid g4 mb-3.5">
        <Kpi label="Open" value={open.length} valueTone={open.length ? 'bad' : undefined} hint="Waiting for the care team" icon="alert" tone="bad" />
        <Kpi label="Urgent" value={urgent.length} hint="Not yet resolved" dir={urgent.length ? 'dn' : undefined} icon="shield" tone="bad" />
        <Kpi label="Acknowledged" value={ack.length} hint="A clinician is on it" icon="clock" tone="warn" />
        <Kpi label="Median time to acknowledge" value={medianLabel} hint={`${all.filter((e) => e.status === 'resolved').length} resolved in total`} icon="trending" tone="ok" />
      </div>

      <div className="tabs mb-3">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`tab ${filter === f.key ? 'on' : ''}`}
            onClick={() => {
              setFilter(f.key)
              setPage(1)
            }}
          >
            {f.label}
            <span className="c">{all.filter((e) => matches(e, f.key)).length}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2.5">
        {paged.pageItems.map((e) => {
          const isBusy = busy?.id === e.id
          return (
            <div key={e.id} className="card esc" style={e.status === 'resolved' ? { opacity: 0.7 } : undefined}>
              <i className="sevbar" style={{ background: EDGE[e.severity] || 'var(--mute)' }} />
              <SeverityBadge severity={e.severity} fixed />
              <button className="w text-left" onClick={() => setSelected(e.id)}>
                <b className="hover:text-brand">{nameOf(e.patient_id)}</b>
                <p>{e.reason}</p>
                <small>
                  Escalation {e.id} · raised in call {e.call_log_id} · {friendlyTime(e.created_at, true)}
                </small>
              </button>
              <StatusBadge status={e.status} />
              <div className="flex gap-2">
                {e.status === 'open' && (
                  <button className="btn" disabled={isBusy} onClick={() => act(e, 'acknowledged')}>
                    {isBusy && busy?.action === 'acknowledged' && <Spinner />} Acknowledge
                  </button>
                )}
                {e.status !== 'resolved' ? (
                  <button className="btn p" disabled={isBusy} onClick={() => act(e, 'resolved')}>
                    {isBusy && busy?.action === 'resolved' && <Spinner />} Resolve
                  </button>
                ) : (
                  <button className="btn sm" onClick={() => setSelected(e.id)}>
                    Details
                  </button>
                )}
              </div>
            </div>
          )
        })}
        {list.length === 0 ? (
          <div className="card">
            <EmptyState icon="checkCircle" text={filter === 'active' ? 'All clear. Nothing needs action.' : 'No escalations here.'} />
          </div>
        ) : (
          paged.totalPages > 1 && (
            <div className="card">
              <Pagination paged={paged} noun="escalations" />
            </div>
          )
        )}
      </div>

      <Drawer
        open={!!sel}
        narrow
        onClose={() => setSelected(null)}
        title={sel ? `Escalation ${sel.id}` : ''}
        subtitle={sel ? `${nameOf(sel.patient_id)} · raised in call ${sel.call_log_id}` : ''}
        footer={
          sel && (
            <>
              {sel.patient_id && (
                <button className="btn" onClick={() => navigate({ to: '/patients/$id', params: { id: String(sel.patient_id) } })}>
                  Open patient
                </button>
              )}
              {sel.status === 'open' && (
                <button className="btn" disabled={busy?.id === sel.id} onClick={() => act(sel, 'acknowledged')}>
                  Acknowledge
                </button>
              )}
              {sel.status !== 'resolved' && (
                <button className="btn p" disabled={busy?.id === sel.id} onClick={() => act(sel, 'resolved', notes.trim())}>
                  {busy?.id === sel.id && busy.action === 'resolved' && <Spinner />} Mark resolved
                </button>
              )}
            </>
          )
        }
      >
        {sel && (
          <>
            <div className="flex gap-2">
              <SeverityBadge severity={sel.severity} />
              <StatusBadge status={sel.status} />
            </div>
            <div className="kv">
              <div>
                <div className="lbl">Raised</div>
                <b>{friendlyTime(sel.created_at, true)}</b>
              </div>
              <div>
                <div className="lbl">Acknowledged</div>
                <b>{sel.acknowledged_at ? friendlyTime(sel.acknowledged_at, true) : '—'}</b>
              </div>
              <div>
                <div className="lbl">Resolved</div>
                <b>{sel.resolved_at ? friendlyTime(sel.resolved_at, true) : '—'}</b>
              </div>
            </div>
            <div>
              <div className="lbl mb-1.5">Reason</div>
              <p className="text-[15px]">{sel.reason}</p>
            </div>
            {selCall?.summary && (
              <div>
                <div className="lbl mb-1.5">What the agent recorded</div>
                <p className="note">{selCall.summary}</p>
              </div>
            )}
            {sel.resolution_notes && (
              <div>
                <div className="lbl mb-1.5">Resolution notes</div>
                <p className="okbox">{sel.resolution_notes}</p>
              </div>
            )}
            {sel.status !== 'resolved' && (
              <div>
                <div className="lbl mb-1.5">Resolution notes</div>
                <textarea className="field" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What was done, and by whom" />
              </div>
            )}
            <button className="btn self-start" onClick={() => navigate({ to: '/escalations/$id', params: { id: String(sel.id) } })}>
              <Icon name="file" className="h-4 w-4" /> Open full page
            </button>
          </>
        )}
      </Drawer>
    </div>
  )
}
