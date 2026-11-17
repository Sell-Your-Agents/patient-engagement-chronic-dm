import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  useFollowUps,
  useUpdateFollowUp,
  useCreateFollowUp,
  FOLLOW_UP_KIND_LABELS,
  followUpOutcome,
  followUpOutcomeTone,
  type FollowUp,
} from '../hooks/useFollowUps'
import { useClinicInfo } from '../hooks/useClinic'
import { PageHeader, Modal, Avatar, EmptyState, ErrorState, TableSkeleton, Pagination, Spinner, StatusBadge, paginate, friendlyTime } from '../components/ui'
import { toast, errorText } from '../components/toast'
import { Icon } from '../components/Icon'

type Tab = 'pending' | 'done' | 'all'

const PRIORITY_PILL: Record<string, { label: string; cls: string }> = {
  urgent: { label: 'Urgent', cls: 'bad' },
  high: { label: 'High', cls: 'warn' },
  normal: { label: 'Normal', cls: 'mute' },
}

export function FollowUpsPage() {
  const [tab, setTab] = useState<Tab>('pending')
  const [kind, setKind] = useState('')
  const [page, setPage] = useState(1)
  const [closing, setClosing] = useState<FollowUp | null>(null)
  const [adding, setAdding] = useState(false)
  const { data, isLoading, error, refetch } = useFollowUps()
  const { data: info } = useClinicInfo()
  const update = useUpdateFollowUp()

  const all = (data || []).filter((t) => !kind || t.kind === kind)
  const pending = all.filter((t) => t.status === 'pending')
  const finished = all.filter((t) => t.status !== 'pending')
  const urgent = pending.filter((t) => t.priority === 'urgent').length
  const shown = tab === 'pending' ? pending : tab === 'done' ? finished : all
  const paged = paginate(shown, page, setPage, 15)

  return (
    <div>
      <PageHeader
        title="Follow-ups"
        subtitle={
          <div className="flex flex-wrap items-center gap-2">
            <div className="tabs">
              {(
                [
                  ['pending', 'To call back', pending.length],
                  ['done', 'Done', finished.length],
                  ['all', 'All', all.length],
                ] as const
              ).map(([k, l, n]) => (
                <button
                  key={k}
                  className={`tab ${tab === k ? 'on' : ''}`}
                  onClick={() => {
                    setTab(k)
                    setPage(1)
                  }}
                >
                  {l} <span className="c">{n}</span>
                </button>
              ))}
            </div>
            <select
              className="field !h-[34px] !w-auto font-bold"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value)
                setPage(1)
              }}
              aria-label="Call outcome"
            >
              <option value="">All call outcomes</option>
              {Object.entries(FOLLOW_UP_KIND_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        }
        actions={
          <button className="btn" onClick={() => setAdding(true)}>
            <Icon name="plus" className="h-4 w-4" /> Add follow-up
          </button>
        }
      />

      {urgent > 0 && tab !== 'done' && (
        <div className="alertbox mb-3.5 !text-[13.5px]">
          <Icon name="alert" className="h-4 w-4 shrink-0" />
          {urgent} urgent follow-up{urgent === 1 ? '' : 's'}: a caller described an emergency or distress. Call them first.
        </div>
      )}

      <div className="note mb-3.5 text-[13px]">
        Every caller {info?.agent_name || 'the agent'} could not fully help ends up here: emergencies, people who want to talk to staff, questions it
        couldn't answer, callback requests and appointment requests to confirm. Urgent first, then oldest first.{' '}
        {info?.human_transfer
          ? 'Callers who ask for a person are put through to the front desk; if nobody answers, they are listed here.'
          : 'No front-desk number is set, so callers who ask for a person are listed here for a callback.'}
      </div>

      <div className="card">
        {isLoading ? (
          <TableSkeleton rows={7} />
        ) : error ? (
          <div className="p-4">
            <ErrorState text="Could not load follow-ups" onRetry={() => refetch()} />
          </div>
        ) : shown.length === 0 ? (
          <EmptyState icon="checkCircle" text={tab === 'pending' ? 'Nobody is waiting for a call back.' : 'Nothing here yet.'} />
        ) : (
          <div className="scroll">
            <table className="t">
              <thead>
                <tr>
                  <th>Priority</th>
                  <th>Who</th>
                  <th>Call outcome</th>
                  <th>Details</th>
                  <th>Waiting since</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.pageItems.map((t) => {
                  const pr = PRIORITY_PILL[t.priority] || PRIORITY_PILL.normal!
                  const isUrgent = t.priority === 'urgent' && t.status === 'pending'
                  return (
                    <tr key={t.id} style={isUrgent ? { background: 'var(--bad-bg)' } : undefined}>
                      <td>
                        <span className={`pill ${pr.cls}`} style={{ width: 70, justifyContent: 'center' }}>
                          {pr.label}
                        </span>
                      </td>
                      <td>
                        <div className="who">
                          <Avatar name={t.patient_name || '?'} size={32} />
                          <div>
                            <b>
                              {t.patient_id ? (
                                <Link to="/patients/$id" params={{ id: String(t.patient_id) }} className="text-ink hover:text-brand">
                                  {t.patient_name || 'Caller'}
                                </Link>
                              ) : (
                                t.patient_name || 'Caller'
                              )}
                            </b>
                            {t.phone_number ? (
                              <a href={`tel:${t.phone_number}`} className="block text-[12.5px] font-bold text-brand">
                                {t.phone_number}
                              </a>
                            ) : (
                              <small>No number</small>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`pill ${followUpOutcomeTone(t)}`}>{followUpOutcome(t)}</span>
                      </td>
                      <td className="max-w-[320px] text-[13px] text-ink-soft">
                        {t.reason || '—'}
                        {(t.doctor_requested || t.preferred_time) && (
                          <small className="mt-1 block text-ink-muted">{[t.doctor_requested, t.preferred_time].filter(Boolean).join(' · ')}</small>
                        )}
                        {t.staff_notes && <small className="mt-1 block text-ink-muted">Note: {t.staff_notes}</small>}
                      </td>
                      <td className="whitespace-nowrap text-[13px]">
                        {friendlyTime(t.created_at, true)}
                        {t.call_ref && (
                          <Link to="/calls/$id" params={{ id: String(t.call_log_id) }} className="block text-[12px] text-brand">
                            call {t.call_ref}
                          </Link>
                        )}
                      </td>
                      <td>
                        <StatusBadge status={t.status} />
                      </td>
                      <td>
                        <div className="flex justify-end gap-1.5">
                          {t.status === 'pending' && t.kind === 'confirm_appointment' && (
                            <Link to="/appointments" className="btn sm p">
                              Confirm visit
                            </Link>
                          )}
                          {t.status === 'pending' && (
                            <button className={`btn sm ${t.kind === 'confirm_appointment' ? '' : 'p'}`} onClick={() => setClosing(t)}>
                              Mark done
                            </button>
                          )}
                          {t.status !== 'pending' && (
                            <button
                              className="btn sm"
                              disabled={update.isPending}
                              onClick={() => update.mutate({ id: t.id, status: 'pending' }, { onSuccess: () => toast.info('Moved back to the call-back list') })}
                            >
                              Reopen
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {!isLoading && <Pagination paged={paged} noun="follow-ups" />}
      </div>

      {closing && <CloseModal task={closing} onClose={() => setClosing(null)} />}
      {adding && <AddModal onClose={() => setAdding(false)} />}
    </div>
  )
}

function CloseModal({ task, onClose }: { task: FollowUp; onClose: () => void }) {
  const update = useUpdateFollowUp()
  const [notes, setNotes] = useState(task.staff_notes || '')
  const finish = (status: 'done' | 'cancelled') =>
    update.mutate(
      { id: task.id, status, staff_notes: notes },
      {
        onSuccess: () => {
          toast.success(status === 'done' ? 'Follow-up done' : 'Follow-up closed', task.patient_name || '')
          onClose()
        },
        onError: (e) => toast.error('Could not save', errorText(e, 'Please try again.')),
      },
    )
  return (
    <Modal open onClose={onClose} title="Close this follow-up" subtitle={`${task.patient_name || 'Caller'} · ${task.phone_number || 'no number'}`}>
      {task.reason && (
        <p className="mb-3 text-[13.5px]">
          <span className="lbl block">They needed</span>
          {task.reason}
        </p>
      )}
      {task.kind === 'confirm_appointment' && (
        <p className="warnbox mb-3 text-[13px]">This only closes the task. To confirm the visit, use Confirm on the Appointments page (that closes this task too).</p>
      )}
      <label className="block">
        <span className="lbl mb-1.5 block">What happened? (optional)</span>
        <textarea className="field !h-24 py-2" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Called, answered the insurance question" autoFocus />
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn d" disabled={update.isPending} onClick={() => finish('cancelled')}>
          Not needed
        </button>
        <button className="btn p" disabled={update.isPending} onClick={() => finish('done')}>
          {update.isPending && <Spinner />} Called them, done
        </button>
      </div>
    </Modal>
  )
}

function AddModal({ onClose }: { onClose: () => void }) {
  const create = useCreateFollowUp()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [reason, setReason] = useState('')
  const [priority, setPriority] = useState('normal')
  const [err, setErr] = useState<string | null>(null)
  const valid = name.trim() && /^\+?[0-9 ()-]{7,20}$/.test(phone.trim())
  const save = () => {
    if (!valid) return
    create.mutate(
      { patient_name: name.trim(), phone_number: phone.trim(), reason: reason.trim() || undefined, priority },
      {
        onSuccess: () => {
          toast.success('Follow-up added', name.trim())
          onClose()
        },
        onError: (e) => setErr(errorText(e, 'Could not add the follow-up.')),
      },
    )
  }
  return (
    <Modal open onClose={onClose} title="Add follow-up" subtitle="Someone the clinic needs to call back">
      <div className="space-y-3.5">
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="lbl mb-1.5 block">Name</span>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          <label>
            <span className="lbl mb-1.5 block">Phone</span>
            <input className="field" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" />
          </label>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <label className="col-span-2">
            <span className="lbl mb-1.5 block">Reason</span>
            <input className="field" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wants report results explained" />
          </label>
          <label>
            <span className="lbl mb-1.5 block">Priority</span>
            <select className="field" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
        </div>
        {err && <p className="alertbox !text-[13px]">{err}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn p" disabled={!valid || create.isPending} onClick={save}>
            {create.isPending && <Spinner />} Add
          </button>
        </div>
      </div>
    </Modal>
  )
}
