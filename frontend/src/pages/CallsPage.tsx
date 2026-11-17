import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useCallPage, useLiveCalls, callerName, INTENT_LABELS, LANGUAGE_LABELS, type Call, type CallSearch } from '../hooks/useCalls'
import { PageHeader, EmptyState, ErrorState, TableSkeleton, Pagination, Avatar, friendlyTime, formatLength } from '../components/ui'
import { IntentBadge, LanguageBadge, BookingBadge } from '../components/clinic'
import { MoreText } from '../components/MoreText'

const PAGE_SIZE = 20
const RANGES = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'all', label: 'All' },
] as const
type Range = (typeof RANGES)[number]['key']

function rangeStart(range: Range): string | undefined {
  if (range === 'all') return undefined
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  if (range === '7d') d.setDate(d.getDate() - 6)
  if (range === '30d') d.setDate(d.getDate() - 29)
  return d.toISOString()
}

const RANGE_WORDS: Record<Range, string> = { today: 'today', '7d': 'in the last 7 days', '30d': 'in the last 30 days', all: '' }

export function CallsPage() {
  const search = useSearch({ strict: false }) as { open?: number | string }
  const navigate = useNavigate()
  useEffect(() => {
    if (search.open) navigate({ to: '/calls/$id', params: { id: String(search.open) }, replace: true })
  }, [search.open, navigate])
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  const [intent, setIntent] = useState('')
  const [language, setLanguage] = useState('')
  const [booking, setBooking] = useState('')
  const [range, setRange] = useState<Range>('today')

  useEffect(() => {
    const t = window.setTimeout(() => setTerm(q.trim()), 300)
    return () => window.clearTimeout(t)
  }, [q])

  const params: CallSearch = {
    page,
    page_size: PAGE_SIZE,
    q: term || undefined,
    intent: intent || undefined,
    language: language || undefined,
    booking_status: booking || undefined,
    date_from: rangeStart(range),
  }
  const filterKey = JSON.stringify({ ...params, page: 0 })
  useEffect(() => setPage(1), [filterKey])

  const { data, isLoading, error, refetch, isFetching } = useCallPage(params)
  const { data: liveData } = useLiveCalls()
  // When a live call starts or finishes, reload the list at once so the row switches between Watch live and View
  const liveKey = (liveData || []).map((c) => c.id).join(',')
  useEffect(() => {
    refetch()
  }, [liveKey, refetch])
  // Live calls are pinned on top of the first page (whatever the filters); the rest is the history
  const live = page === 1 ? liveData || [] : []
  const liveIds = new Set(live.map((c) => c.id))
  const calls = (data?.items || []).filter((c) => !liveIds.has(c.id) && c.status !== 'in-progress')
  const total = data?.total || 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div>
      <PageHeader title="Call Records" />

      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <div className="tabs">
          {RANGES.map((r) => (
            <button key={r.key} className={`tab ${range === r.key ? 'on' : ''}`} onClick={() => setRange(r.key)}>
              {r.label}
            </button>
          ))}
        </div>
        <select className="field !h-[34px] !w-auto font-bold" value={intent} onChange={(e) => setIntent(e.target.value)} aria-label="Intent">
          <option value="">All intents</option>
          {Object.entries(INTENT_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select className="field !h-[34px] !w-auto font-bold" value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Language">
          <option value="">All languages</option>
          {Object.entries(LANGUAGE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select className="field !h-[34px] !w-auto font-bold" value={booking} onChange={(e) => setBooking(e.target.value)} aria-label="Booking">
          <option value="">Any booking</option>
          <option value="pending">Pending confirmation</option>
          <option value="confirmed">Confirmed</option>
          <option value="not_applicable">No booking</option>
        </select>
        <input className="field !h-[34px] ml-auto !w-64" placeholder="Name, phone or SS-1125" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search calls" />
      </div>

      <div className="card">
        {isLoading ? (
          <TableSkeleton rows={8} />
        ) : error ? (
          <div className="p-4">
            <ErrorState text="Could not load call records" onRetry={() => refetch()} />
          </div>
        ) : calls.length === 0 && live.length === 0 ? (
          <EmptyState icon="phone" text={range === 'today' ? 'No calls yet today.' : 'No calls match these filters.'} />
        ) : (
          <div className="scroll">
            {/* Fixed widths: every row is two short lines and the table always fits the page */}
            <table className="t table-fixed w-full">
              <colgroup>
                <col style={{ width: '9%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '18%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '10%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Call</th>
                  <th>Caller</th>
                  <th>Language</th>
                  <th>Intent</th>
                  <th>Call outcome</th>
                  <th>Booking</th>
                  <th>Next action</th>
                  <th>Call log</th>
                </tr>
              </thead>
              <tbody>
                {live.map((c) => (
                  <tr key={`live-${c.id}`} style={{ background: 'var(--ok-bg)' }}>
                    <td>
                      <b className="block truncate">{c.call_ref}</b>
                      <small className="block truncate text-ink-muted">now</small>
                    </td>
                    <td>
                      <CallerCell call={c} />
                    </td>
                    <td className="overflow-hidden">
                      {c.language ? <LanguageBadge language={c.language} /> : <span className="text-[12.5px] text-ink-muted">choosing…</span>}
                    </td>
                    <td className="overflow-hidden">
                      <span className="pill ok dotted">Live</span>
                    </td>
                    <td className="text-ink-muted">—</td>
                    <td className="text-ink-muted">—</td>
                    <td className="text-ink-muted">—</td>
                    <td className="text-right">
                      <Link to="/calls/$id" params={{ id: String(c.id) }} className="btn sm whitespace-nowrap !border-ok !bg-ok !text-white">
                        <span className="dot" /> Watch live
                      </Link>
                    </td>
                  </tr>
                ))}
                {calls.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <b className="block truncate">{c.call_ref}</b>
                      <small className="block truncate text-ink-muted" title={`${friendlyTime(c.started_at || c.created_at, true)} · ${formatLength(c.duration_seconds)}`}>
                        {friendlyTime(c.started_at || c.created_at, true)}
                      </small>
                    </td>
                    <td>
                      <CallerCell call={c} />
                    </td>
                    <td className="overflow-hidden">
                      <LanguageBadge language={c.language} />
                    </td>
                    <td className="overflow-hidden" title={c.intent ? INTENT_LABELS[c.intent] || c.intent : undefined}>
                      <IntentBadge intent={c.intent} />
                    </td>
                    <td className="text-[13px] text-ink-soft">
                      <MoreText text={c.outcome} limit={28} />
                    </td>
                    <td className="overflow-hidden">
                      <BookingBadge status={c.booking_status} />
                    </td>
                    <td className="text-[13px] text-ink-soft">
                      <MoreText text={c.next_action} limit={18} />
                    </td>
                    <td className="text-right">
                      <Link to="/calls/$id" params={{ id: String(c.id) }} className="btn sm">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > 0 ? (
          <Pagination
            paged={{
              page,
              setPage,
              totalPages: pages,
              total,
              from: (page - 1) * PAGE_SIZE + 1,
              to: Math.min(page * PAGE_SIZE, total),
            }}
            noun={`calls ${RANGE_WORDS[range]}${live.length ? ` · ${live.length} live now` : ''}${isFetching ? ' · updating…' : ''}`.trim()}
          />
        ) : (
          live.length > 0 && <div className="border-t border-line px-4 py-2.5 text-[12.5px] text-ink-muted">{live.length} live now · no finished calls yet</div>
        )}
      </div>
    </div>
  )
}

function CallerCell({ call }: { call: Call }) {
  const name = callerName(call)
  return (
    <div className="who min-w-0">
      <Avatar name={name || '?'} size={28} />
      <div className="min-w-0">
        <b className="block truncate" title={name || undefined}>
          {name || 'Unknown caller'}
        </b>
        <small className="block truncate">
          {call.phone_number || 'No number'}
          {call.channel === 'browser' ? ' · test' : ''}
        </small>
      </div>
    </div>
  )
}
