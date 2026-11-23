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
import { PageHeader, Modal, Avatar, EmptyState, ErrorState, TableSkeleton, Pagination, Spinner, StatusBadge, paginate, friendlyTime, sentenceCase, plainTime } from '../components/ui'
import { toast, errorText } from '../components/toast'
import { Icon } from '../components/Icon'

type Tab = 'pending' | 'done' | 'all'

const PRIORITY_PILL: Record<string, { label: string; cls: string }> = {
  urgent: { label: 'Urgent', cls: 'bad' },
  high: { label: 'High', cls: 'warn' },
  normal: { label: 'Normal', cls: 'mute' },
}
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2 }

/** All follow-ups raised by one call, shown as a single row. */
type CallGroup = {
  key: string
  items: FollowUp[]
  lead: FollowUp // newest item: supplies who / when / call link
  priority: string
  pending: FollowUp[]
}

function groupByCall(items: FollowUp[]): CallGroup[] {
  const map = new Map<string, FollowUp[]>()
  for (const t of items) {
    const key = t.call_log_id != null ? `call-${t.call_log_id}` : `fu-${t.id}`
    const list = map.get(key)
    if (list) list.push(t)
    else map.set(key, [t])
  }
  return [...map.entries()].map(([key, list]) => {
    const priority = list.reduce((best, t) => ((PRIORITY_RANK[t.priority] ?? 2) < (PRIORITY_RANK[best] ?? 2) ? t.priority : best), 'normal')
    return { key, items: list, lead: list[0]!, priority, pending: list.filter((t) => t.status === 'pending') }
  })
}

export function FollowUpsPage() {
  const [tab, setTab] = useState<Tab>('pending')
  const [kind, setKind] = useState('')
  const [page, setPage] = useState(1)
  const [closing, setClosing] = useState<FollowUp[] | null>(null)
  const [reopening, setReopening] = useState(false)
  const [adding, setAdding] = useState(false)
  const { data, isLoading, error, refetch } = useFollowUps()
  const { data: info } = useClinicInfo()
  const update = useUpdateFollowUp()

  const all = (data || [])
    .filter((t) => !kind || t.kind === kind)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
  const pending = groupByCall(all.filter((t) => t.status === 'pending'))
  const finished = groupByCall(all.filter((t) => t.status !== 'pending'))
  const allGroups = groupByCall(all)
  const urgent = pending.filter((g) => g.priority === 'urgent').length
  const shown = tab === 'pending' ? pending : tab === 'done' ? finished : allGroups
  const paged = paginate(shown, page, setPage, 15)

  const reopen = async (items: FollowUp[]) => {
    setReopening(true)
    try {
      await Promise.all(items.map((t) => update.mutateAsync({ id: t.id, status: 'pending' })))
      toast.info('Moved back to the call-back list')
    } catch (e) {
      toast.error('Could not reopen', errorText(e, 'Please try again.'))
    } finally {
      setReopening(false)
    }
  }

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
                  ['all', 'All', allGroups.length],
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
        // actions={
        //   <button className="btn" onClick={() => setAdding(true)}>
        //     <Icon name="plus" className="h-4 w-4" /> Add follow-up
        //   </button>
        // }
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
                {paged.pageItems.map((g) => {
                  const t = g.lead
                  const pr = PRIORITY_PILL[g.priority] || PRIORITY_PILL.normal!
                  const isUrgent = g.priority === 'urgent' && g.pending.length > 0
                  const outcomes = [...new Map(g.items.map((i) => [followUpOutcome(i), followUpOutcomeTone(i)])).entries()]
                  const needsConfirm = g.pending.some((i) => i.kind === 'confirm_appointment')
                  const needsCancel = g.pending.some((i) => i.kind === 'cancel_request')
                  return (
                    <tr key={g.key} style={isUrgent ? { background: 'var(--bad-bg)' } : undefined}>
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
                              <a href={`tel:${t.phone_number}`} className="block whitespace-nowrap text-[12.5px] font-bold text-brand">
                                {t.phone_number}
                              </a>
                            ) : (
                              <small>No number</small>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="flex flex-col items-start gap-1">
                          {outcomes.map(([label, tone]) => (
                            <span key={label} className={`pill ${tone}`}>
                              {label}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="max-w-[320px] text-[13px] text-ink-soft">
                        {/* Fixed height keeps every row the same size; longer details scroll inside the cell. */}
                        <div className="flex h-[84px] flex-col overflow-y-auto pr-1">
                        <div className="my-auto">
                        {g.items.map((i, idx) => (
                          <div key={i.id} className={idx > 0 ? 'mt-2 border-t border-dashed border-line pt-2' : undefined}>
                            {g.items.length > 1 && <small className="block font-bold text-ink-muted">{followUpOutcome(i)}</small>}
                            {sentenceCase(i.reason) || '—'}
                            {(i.doctor_requested || i.preferred_time) && (
                              <small className="mt-1 block text-ink-muted">{plainTime([i.doctor_requested, i.preferred_time].filter(Boolean).join(' · '))}</small>
                            )}
                            {i.staff_notes && <small className="mt-1 block text-ink-muted">Note: {i.staff_notes}</small>}
                          </div>
                        ))}
                        </div>
                        </div>
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
                        <StatusBadge status={g.pending.length > 0 ? 'pending' : t.status} />
                      </td>
                      <td>
                        <div className="flex justify-end gap-1.5">
                          {needsConfirm && (
                            <Link to="/appointments" className="btn sm p">
                              Confirm visit
                            </Link>
                          )}
                          {needsCancel && (
                            <Link to="/appointments" className="btn sm d">
                              Confirm cancel
                            </Link>
                          )}
                          {g.pending.length > 0 && (
                            <button className={`btn sm ${needsConfirm || needsCancel ? '' : 'p'}`} onClick={() => setClosing(g.pending)}>
                              Mark done
                            </button>
                          )}
                          {g.pending.length === 0 && (
                            <button className="btn sm" disabled={reopening} onClick={() => reopen(g.items)}>
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

      {closing && <CloseModal tasks={closing} onClose={() => setClosing(null)} />}
      {adding && <AddModal onClose={() => setAdding(false)} />}
    </div>
  )
}

function CloseModal({ tasks, onClose }: { tasks: FollowUp[]; onClose: () => void }) {
  const update = useUpdateFollowUp()
  const task = tasks[0]!
  const [notes, setNotes] = useState(tasks.map((t) => t.staff_notes).find(Boolean) || '')
  const [saving, setSaving] = useState(false)
  const reasons = tasks.map((t) => t.reason).filter(Boolean)
  const finish = async (status: 'done' | 'cancelled') => {
    setSaving(true)
    try {
      await Promise.all(tasks.map((t) => update.mutateAsync({ id: t.id, status, staff_notes: notes })))
      toast.success(status === 'done' ? 'Follow-up done' : 'Follow-up closed', task.patient_name || '')
      onClose()
    } catch (e) {
      toast.error('Could not save', errorText(e, 'Please try again.'))
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal open onClose={onClose} title="Close this follow-up" subtitle={`${task.patient_name || 'Caller'} · ${task.phone_number || 'no number'}`}>
      {reasons.length > 0 && (
        <div className="mb-3 text-[13.5px]">
          <span className="lbl block">They needed</span>
          {reasons.length === 1 ? (
            reasons[0]
          ) : (
            <ul className="list-disc pl-5">
              {reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {tasks.some((t) => t.kind === 'confirm_appointment') && (
        <p className="warnbox mb-3 text-[13px]">This only closes the task. To confirm the visit, use Confirm on the Appointments page (that closes this task too).</p>
      )}
      {tasks.some((t) => t.kind === 'cancel_request') && (
        <p className="warnbox mb-3 text-[13px]">
          This only closes the task: the appointment is not cancelled. To cancel it, use Confirm cancel on the Appointments page (that closes this task
          too).
        </p>
      )}
      <label className="block">
        <span className="lbl mb-1.5 block">What happened? (optional)</span>
        <textarea className="field !h-24 py-2" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Called, answered the insurance question" autoFocus />
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn d" disabled={saving} onClick={() => finish('cancelled')}>
          Not needed
        </button>
        <button className="btn p" disabled={saving} onClick={() => finish('done')}>
          {saving && <Spinner />} Called them, done
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
