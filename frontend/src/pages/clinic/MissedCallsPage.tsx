import { useState } from 'react'
import {
  useMissedCalls,
  useCreateMissedCall,
  useDeleteMissedCall,
  useStartCallback,
  apiErrorMessage,
} from '../../hooks/useClinic'
import { Icon } from '../../components/Icon'
import {
  PageHeader,
  Panel,
  StatusBadge,
  EmptyState,
  Loader,
  ErrorState,
  formatShortDateTime,
  paginate,
  Pagination,
} from '../../components/ui'

const FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'calling', label: 'Calling' },
  { key: 'booked', label: 'Booked' },
  { key: 'no_booking', label: 'No booking' },
  { key: 'no_answer', label: 'No answer' },
  { key: 'failed', label: 'Failed' },
]

function nowForInput() {
  const d = new Date()
  d.setSeconds(0, 0)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export function MissedCallsPage() {
  const { data: missedCalls, isLoading, error } = useMissedCalls()
  const { mutateAsync: createMissedCall, isPending: isSaving } = useCreateMissedCall()
  const { mutate: deleteMissedCall } = useDeleteMissedCall()
  const { mutate: startCallback, isPending: isCalling, variables: callingId } = useStartCallback()

  const [form, setForm] = useState({ phone_number: '', caller_name: '', missed_at: nowForInput(), notes: '' })
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null)

  if (isLoading) return <Loader text="Loading missed calls..." />
  if (error) return <ErrorState text="Error loading missed calls" />

  const list = missedCalls || []
  const filtered = list.filter((m) => filter === 'all' || m.status === filter)
  const paged = paginate(filtered, page, setPage, 6)
  const countFor = (key: string) => (key === 'all' ? list.length : list.filter((m) => m.status === key).length)

  const callBack = (id: number) => {
    setBanner(null)
    startCallback(id, {
      onSuccess: () => setBanner({ ok: true, text: 'The agent is calling back now. Results will appear in Callback Logs.' }),
      onError: (err) => setBanner({ ok: false, text: apiErrorMessage(err, 'Failed to start callback') }),
    })
  }

  const save = async (andCall: boolean) => {
    if (!form.phone_number.trim()) return
    setBanner(null)
    try {
      const raw = form.phone_number.replace(/\s/g, '')
      const created = await createMissedCall({
        phone_number: raw.startsWith('+') ? raw : `+91${raw}`,
        caller_name: form.caller_name || undefined,
        missed_at: form.missed_at || undefined,
        notes: form.notes || undefined,
      })
      setForm({ phone_number: '', caller_name: '', missed_at: nowForInput(), notes: '' })
      if (andCall) callBack(created.id)
      else setBanner({ ok: true, text: 'Missed call saved.' })
    } catch (err) {
      setBanner({ ok: false, text: apiErrorMessage(err, 'Failed to save missed call') })
    }
  }

  return (
    <div>
      <PageHeader title="Missed Calls" subtitle="Log numbers the clinic couldn't answer and let the agent call them back." />

      {banner && (
        <div
          className={`mb-5 flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold ${
            banner.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
          }`}
        >
          <Icon name={banner.ok ? 'checkCircle' : 'alert'} className="h-4 w-4 shrink-0" />
          {banner.text}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[340px_1fr]">
        {/* Log form */}
        <Panel title="Log Missed Call" className="h-fit">
          <div className="space-y-3 px-5 pb-5">
            <div>
              <label className="mb-1.5 block text-xs font-bold text-ink-soft">Phone number *</label>
              <div className="clay-input flex items-center gap-2">
                {!form.phone_number.trim().startsWith('+') && (
                  <span className="text-sm font-bold text-ink-soft">+91</span>
                )}
                <input
                  value={form.phone_number}
                  onChange={(e) => setForm({ ...form, phone_number: e.target.value })}
                  placeholder="98765 43210"
                  inputMode="tel"
                  className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-muted"
                />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold text-ink-soft">Caller name (if known)</label>
              <input
                value={form.caller_name}
                onChange={(e) => setForm({ ...form, caller_name: e.target.value })}
                placeholder="Optional"
                className="clay-input"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold text-ink-soft">Missed at</label>
              <input
                type="datetime-local"
                value={form.missed_at}
                onChange={(e) => setForm({ ...form, missed_at: e.target.value })}
                className="clay-input"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold text-ink-soft">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Optional"
                rows={2}
                className="clay-input resize-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3 pt-1">
              <button onClick={() => save(false)} disabled={!form.phone_number.trim() || isSaving} className="clay-btn-ghost">
                Save
              </button>
              <button onClick={() => save(true)} disabled={!form.phone_number.trim() || isSaving} className="clay-btn">
                <Icon name="phoneCall" className="h-4 w-4" /> Call Back
              </button>
            </div>
          </div>
        </Panel>

        {/* List */}
        <Panel
          title="Missed Call Queue"
          right={
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => {
                    setFilter(f.key)
                    setPage(1)
                  }}
                  className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                    filter === f.key ? 'bg-orange-500 text-white shadow' : 'text-ink-soft hover:bg-white'
                  }`}
                >
                  {f.label} <span className="opacity-70">{countFor(f.key)}</span>
                </button>
              ))}
            </div>
          }
        >
          <div>
            <table className="clay-table">
              <thead>
                <tr>
                  <th>Caller</th>
                  <th className="col-md">Missed At</th>
                  <th>Status</th>
                  <th className="col-2xl">Attempts</th>
                  <th className="col-2xl">Last Attempt</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.pageItems.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <p className="font-bold text-ink">{m.phone_number}</p>
                      <p className="text-xs font-semibold text-ink-soft">{m.caller_name || 'Unknown caller'}</p>
                      {m.notes && <p className="mt-0.5 max-w-[240px] truncate text-xs text-ink-muted">{m.notes}</p>}
                    </td>
                    <td className="col-md whitespace-nowrap text-ink-soft">{formatShortDateTime(m.missed_at)}</td>
                    <td>
                      <StatusBadge status={m.status} />
                    </td>
                    <td className="col-2xl font-semibold">{m.attempts}</td>
                    <td className="col-2xl whitespace-nowrap text-ink-soft">{formatShortDateTime(m.last_attempt_at, true)}</td>
                    <td>
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => callBack(m.id)}
                          disabled={m.status === 'calling' || (isCalling && callingId === m.id)}
                          className="clay-btn btn-sm"
                        >
                          <Icon name="phoneCall" className="h-3.5 w-3.5" />
                          {m.status === 'calling' || (isCalling && callingId === m.id)
                            ? 'Calling...'
                            : m.attempts > 0
                              ? 'Call Again'
                              : 'Call Back'}
                        </button>
                        {m.attempts === 0 && (
                          <button
                            onClick={() => deleteMissedCall(m.id)}
                            className="clay-btn-ghost btn-icon !h-8 !w-8 text-rose-500"
                            title="Remove"
                          >
                            <Icon name="trash" className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && <EmptyState icon="phoneMissed" text="No missed calls here" />}
          </div>
          <Pagination paged={paged} noun="missed calls" />
        </Panel>
      </div>
    </div>
  )
}
