import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { PatientFilterChip } from '../components/clinic'
import {
  useFollowUps,
  useUpdateFollowUp,
  FOLLOW_UP_KIND_LABELS,
  savedAndHeard,
  followUpRowKey,
  followUpOutcome,
  followUpOutcomeTone,
  type FollowUp,
} from '../hooks/useFollowUps'
import { PageHeader, Modal, Avatar, EmptyState, ErrorState, TableSkeleton, Pagination, Spinner, paginate, friendlyTime, sentenceCase, plainTime } from '../components/ui'
import { toast, errorText } from '../components/toast'
import { Icon } from '../components/Icon'
import { backTarget, useListState, useScrollMemory, type From } from '../lib/backNav'

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
    const key = followUpRowKey(t)
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
  // Tab, outcome filter and page: kept while a call or patient is open, so coming back shows the list as it was
  const search = useSearch({ from: '/follow-ups' }) as { patient?: number; from?: From }
  const navigate = useNavigate()
  // Opened from a patient's page: a back button returns there (kept in state; the URL is cleaned below)
  const [cameFrom] = useState(search.from)
  const { state: view, set, restored } = useListState('/follow-ups', {
    tab: 'pending' as Tab,
    kind: '',
    page: 1,
    // One patient only (from a patient's page); Clear or a refresh shows everyone again
    patientId: (search.patient || null) as number | null,
  })
  const { tab, kind, page, patientId } = view
  const setPatientId = (v: number | null) => set('patientId', v)
  useEffect(() => {
    if (search.patient) {
      setPatientId(search.patient)
      set('tab', 'pending')
      set('kind', '')
    }
    // Clean the URL so a refresh shows everyone
    if (search.patient || search.from) navigate({ to: '/follow-ups', search: {}, replace: true })
  }, [search.patient]) // eslint-disable-line react-hooks/exhaustive-deps
  const setTab = (v: Tab) => set('tab', v)
  const setKind = (v: string) => set('kind', v)
  const setPage = (v: number) => set('page', v)
  const [closing, setClosing] = useState<FollowUp[] | null>(null)
  const [reopening, setReopening] = useState(false)
  const { data, isLoading, error, refetch } = useFollowUps()
  const update = useUpdateFollowUp()
  useScrollMemory('/follow-ups', restored, !!data)

  const all = (data || [])
    .filter((t) => (!kind || t.kind === kind) && (!patientId || t.patient_id === patientId))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
  // One row per call. A call is "to call back" while any of its tasks is open, and "done" once all are finished,
  // so To call back + Done = All.
  const allGroups = groupByCall(all)
  const pending = groupByCall(all.filter((t) => t.status === 'pending'))
  const finished = allGroups.filter((g) => g.pending.length === 0)
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
        back={cameFrom ? backTarget(cameFrom, { to: '/follow-ups', label: 'Follow-ups' }) : undefined}
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
      />

      {patientId && (
        <div className="mb-2.5">
          <PatientFilterChip
            name={(data || []).filter((t) => t.patient_id === patientId).map((t) => t.patient_saved_name || t.patient_name)[0] || 'this patient'}
            onClear={() => setPatientId(null)}
          />
        </div>
      )}

      {urgent > 0 && tab !== 'done' && (
        <div className="alertbox mb-3.5 !text-[13.5px]">
          <Icon name="alert" className="h-4 w-4 shrink-0" />
          {urgent} urgent follow-up{urgent === 1 ? '' : 's'}: a caller described an emergency or distress. Call them first.
        </div>
      )}

      <div className="card">
        {isLoading ? (
          <TableSkeleton rows={7} />
        ) : error ? (
          <div className="p-4">
            <ErrorState text="Could not load follow-ups" onRetry={() => refetch()} />
          </div>
        ) : shown.length === 0 ? (
          <EmptyState icon="checkCircle" text={patientId ? 'No follow-ups for this patient here.' : tab === 'pending' ? 'Nobody is waiting for a call back.' : 'Nothing here yet.'} />
        ) : (
          <div className="scroll">
            <table className="t table-fixed w-full min-w-[980px]">
              <colgroup>
                <col style={{ width: '9%' }} />
                <col style={{ width: '19%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '36%' }} />
                <col style={{ width: '23%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Priority</th>
                  <th>Caller name</th>
                  <th>Requested on</th>
                  <th>Details</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.pageItems.map((g) => {
                  const t = g.lead
                  const pr = PRIORITY_PILL[g.priority] || PRIORITY_PILL.normal!
                  const isUrgent = g.priority === 'urgent' && g.pending.length > 0
                  // The appointment this follow-up is about (confirm, cancel or a patient's reschedule): the button opens exactly that one
                  const apptItem = g.pending.find((i) => i.appointment_id || i.kind === 'confirm_appointment' || i.kind === 'cancel_request')
                  const apptSearch = apptItem?.appointment_id
                    ? { open: apptItem.appointment_id, from: 'follow-ups' as const }
                    : apptItem?.call_log_id
                      ? { call: apptItem.call_log_id, from: 'follow-ups' as const }
                      : null
                  const { name, said } = savedAndHeard(t)
                  const label = name || 'Caller'
                  return (
                    <tr key={g.key} className="align-top" style={isUrgent ? { background: 'var(--bad-bg)' } : undefined}>
                      <td>
                        <span className={`pill ${pr.cls}`} style={{ width: 70, justifyContent: 'center' }}>
                          {pr.label}
                        </span>
                      </td>
                      <td>
                        <div className="who min-w-0 !items-start">
                          <Avatar name={label} size={32} />
                          <div className="min-w-0">
                            <b className={`person-name ${label.length > 22 ? 'long' : ''}`}>
                              {t.patient_id ? (
                                <Link to="/patients/$id" params={{ id: String(t.patient_id) }} search={{ from: 'follow-ups' }} className="text-ink hover:text-brand">
                                  {label}
                                </Link>
                              ) : (
                                label
                              )}
                            </b>
                            {said && <span className="said-as">Name said on the call: {said}</span>}
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
                      <td className="text-[13px]">
                        <span className="block font-bold">{friendlyTime(t.created_at, true)}</span>
                        {t.call_ref && (
                          <Link to="/calls/$id" params={{ id: String(t.call_log_id) }} search={{ from: 'follow-ups' }} className="block text-[12px] font-bold text-brand" title="Open the call: transcript and recording">
                            Call {t.call_ref} →
                          </Link>
                        )}
                      </td>
                      <td className="text-[13px] leading-relaxed text-ink-soft">
                        {/* The whole text: the row grows instead of scrolling inside the cell */}
                        <div className="break-words">
                        {g.items.map((i, idx) => (
                          <div key={i.id} className={idx > 0 ? 'mt-2 border-t border-dashed border-line pt-2' : undefined}>
                            <span className={`pill ${followUpOutcomeTone(i)} mb-1 !whitespace-normal`}>{followUpOutcome(i)}</span>
                            <span className="block">
                            {sentenceCase(i.reason) || '—'}
                            </span>
                            {(i.doctor_requested || i.preferred_time) && (
                              <small className="mt-1 block text-ink-muted">{plainTime([i.doctor_requested, i.preferred_time].filter(Boolean).join(' · '))}</small>
                            )}
                            {i.staff_notes && (
                              <small className="mt-1 block text-ink-muted">
                                <b>Remarks:</b> {i.staff_notes}
                              </small>
                            )}
                          </div>
                        ))}
                        </div>
                      </td>
                      <td>
                        <div className="row-acts">
                          {apptSearch && (
                            <Link to="/appointments" search={apptSearch} className="btn sm p" title="Open this patient's appointment: confirm, reschedule or cancel it there">
                              View appointment
                            </Link>
                          )}
                          {g.pending.length > 0 && (
                            <button
                              className={`btn sm ${apptSearch ? '' : 'p'}`}
                              onClick={() => setClosing(g.pending)}
                              title="You called them back: add a remark and close the follow-up"
                            >
                              <Icon name="check" className="h-3.5 w-3.5" /> Mark as done
                            </button>
                          )}
                          {g.pending.length === 0 && (
                            <>
                              <span className="pill ok dotted">{t.status === 'cancelled' ? 'Closed' : 'Done'}</span>
                              <button className="btn sm" disabled={reopening} onClick={() => reopen(g.items)}>
                                Reopen
                              </button>
                            </>
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
    </div>
  )
}

function CloseModal({ tasks, onClose }: { tasks: FollowUp[]; onClose: () => void }) {
  const update = useUpdateFollowUp()
  const task = tasks[0]!
  const [notes, setNotes] = useState(tasks.map((t) => t.staff_notes).find(Boolean) || '')
  const [saving, setSaving] = useState(false)
  const reasons = tasks.map((t) => t.reason).filter(Boolean)
  const valid = notes.trim().length >= 3
  const finish = async () => {
    if (!valid) return
    setSaving(true)
    try {
      await Promise.all(tasks.map((t) => update.mutateAsync({ id: t.id, status: 'done', staff_notes: notes.trim() })))
      toast.success('Marked as done', savedAndHeard(task).name || '')
      onClose()
    } catch (e) {
      toast.error('Could not save', errorText(e, 'Please try again.'))
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal open onClose={onClose} title="Mark as done" subtitle={`${savedAndHeard(task).name || 'Caller'} · ${task.phone_number || 'no number'}`}>
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
        <p className="warnbox mb-3 text-[13px]">This only closes the follow-up. To confirm the visit, use View appointment and press Confirm there (that closes this follow-up too).</p>
      )}
      {tasks.some((t) => t.kind === 'cancel_request') && (
        <p className="warnbox mb-3 text-[13px]">
          This only closes the follow-up: the appointment is not cancelled. To cancel it, use View appointment and press Confirm cancel there (that closes this follow-up too).
        </p>
      )}
      <label className="block">
        <span className="lbl mb-1.5 block">Remarks</span>
        <textarea
          className="field !h-24 py-2"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What happened? e.g. Called back, explained the timings. Or: test call, nothing needed."
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void finish()
          }}
        />
        {!valid && <small className="mt-1 block text-ink-muted">Write a short remark so the team knows what was done.</small>}
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>
          Back
        </button>
        <button className="btn p" disabled={saving || !valid} onClick={() => void finish()}>
          {saving && <Spinner />} Mark as done
        </button>
      </div>
    </Modal>
  )
}
