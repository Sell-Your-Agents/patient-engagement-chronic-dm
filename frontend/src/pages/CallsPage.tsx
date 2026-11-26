import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useCallPage, callerName, INTENT_LABELS, LANGUAGE_LABELS, type Call, type CallSearch } from '../hooks/useCalls'
import { PageHeader, EmptyState, ErrorState, TableSkeleton, Pagination, Avatar, friendlyTime, formatLength } from '../components/ui'
import { IntentBadge, LanguageBadge, BookingLink } from '../components/clinic'
import { Icon } from '../components/Icon'
import { useListState, useOnChange, useScrollMemory } from '../lib/backNav'

const PAGE_SIZE = 20
const RANGES = [
  { key: 'all', label: 'All time' },
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
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

/** Finished calls only (a call shows up here once it has ended), newest first, paged on the server. */
export function CallsPage() {
  const search = useSearch({ strict: false }) as { open?: number | string }
  const navigate = useNavigate()
  useEffect(() => {
    if (search.open) navigate({ to: '/calls/$id', params: { id: String(search.open) }, search: { from: 'calls' }, replace: true })
  }, [search.open, navigate])
  // Filters, search and page: kept while a call is open, so "All call records" brings the list back as it was
  const { state: view, set, restored } = useListState('/calls', { page: 1, q: '', intent: '', language: '', booking: '', range: 'all' as Range })
  const { page, q, intent, language, booking, range } = view
  const setPage = (n: number) => set('page', n)
  const setQ = (v: string) => set('q', v)
  const setIntent = (v: string) => set('intent', v)
  const setLanguage = (v: string) => set('language', v)
  const setBooking = (v: string) => set('booking', v)
  const setRange = (v: Range) => set('range', v)
  const [term, setTerm] = useState(q.trim())
  const [filtersOpen, setFiltersOpen] = useState(false)
  const filtersRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = window.setTimeout(() => setTerm(q.trim()), 300)
    return () => window.clearTimeout(t)
  }, [q])

  // Close the filter panel on a click outside it, or Escape
  useEffect(() => {
    if (!filtersOpen) return
    const onClick = (e: MouseEvent) => {
      if (filtersRef.current && !filtersRef.current.contains(e.target as Node)) setFiltersOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFiltersOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [filtersOpen])

  const params: CallSearch = {
    page,
    page_size: PAGE_SIZE,
    q: term || undefined,
    intent: intent || undefined,
    language: language || undefined,
    booking_status: booking || undefined,
    date_from: rangeStart(range),
    finished_only: true,
  }
  const filterKey = JSON.stringify({ ...params, page: 0 })
  // A filter change goes back to page 1 (but not when the list is first shown, so a restored page stays)
  useOnChange(filterKey, () => setPage(1))

  const { data, isLoading, error, refetch, isFetching } = useCallPage(params)
  useScrollMemory('/calls', restored, !!data)
  const calls = data?.items || []
  const total = data?.total || 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  // Filters inside the panel that are not at their default
  const activeFilters = [range !== 'all', !!intent, !!language].filter(Boolean).length
  const clearFilters = () => {
    setRange('all')
    setIntent('')
    setLanguage('')
  }

  return (
    <div>
      <PageHeader title="Call Records" />

      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <select className="field !h-[34px] !w-auto font-bold" value={booking} onChange={(e) => setBooking(e.target.value)} aria-label="Booking">
          <option value="">Any booking</option>
          <option value="pending">Pending appointment</option>
          <option value="confirmed">Confirmed by Staff</option>
          <option value="not_applicable">No booking</option>
        </select>

        <div className="relative" ref={filtersRef}>
          <button
            className={`btn !h-[34px] ${activeFilters ? '!border-brand !text-brand' : ''}`}
            onClick={() => setFiltersOpen((o) => !o)}
            aria-expanded={filtersOpen}
          >
            <Icon name="filter" className="h-4 w-4" /> Filters
            {activeFilters > 0 && <span className="filter-count">{activeFilters}</span>}
          </button>
          {filtersOpen && (
            <div className="filter-panel" role="dialog" aria-label="Filters">
              <span className="lbl mb-1.5 block">Date</span>
              <div className="tabs mb-3.5 !grid w-full grid-cols-4">
                {RANGES.map((r) => (
                  <button key={r.key} className={`tab justify-center !px-1 text-center ${range === r.key ? 'on' : ''}`} onClick={() => setRange(r.key)}>
                    {r.label}
                  </button>
                ))}
              </div>
              <label className="mb-3.5 block">
                <span className="lbl mb-1.5 block">Intent</span>
                <select className="field" value={intent} onChange={(e) => setIntent(e.target.value)}>
                  <option value="">All intents</option>
                  {Object.entries(INTENT_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mb-3.5 block">
                <span className="lbl mb-1.5 block">Language</span>
                <select className="field" value={language} onChange={(e) => setLanguage(e.target.value)}>
                  <option value="">All languages</option>
                  {Object.entries(LANGUAGE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex justify-between gap-2 border-t border-line pt-3">
                <button className="btn sm" disabled={!activeFilters} onClick={clearFilters}>
                  Clear filters
                </button>
                <button className="btn sm p" onClick={() => setFiltersOpen(false)}>
                  Done
                </button>
              </div>
            </div>
          )}
        </div>

        <input className="field !h-[34px] ml-auto !w-64" placeholder="Name, phone or SS-1125" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search calls" />
      </div>

      <div className="card">
        {isLoading ? (
          <TableSkeleton rows={8} />
        ) : error ? (
          <div className="p-4">
            <ErrorState text="Could not load call records" onRetry={() => refetch()} />
          </div>
        ) : calls.length === 0 ? (
          <EmptyState icon="phone" text={term || booking || activeFilters ? 'No calls match these filters.' : 'No calls yet.'} />
        ) : (
          <div className="scroll">
            {/* Fixed widths: every row is two short lines and the table always fits the page */}
            <table className="t table-fixed w-full">
              <colgroup>
                <col style={{ width: '10%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '26%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '18%' }} />
                <col style={{ width: '8%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Call ID</th>
                  <th>Caller name</th>
                  <th>Language</th>
                  <th>Outcome</th>
                  <th>Booking status</th>
                  <th>Next action</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => (
                  <tr
                    key={c.id}
                    className="call-row row-link"
                    onClick={() => navigate({ to: '/calls/$id', params: { id: String(c.id) }, search: { from: 'calls' } })}
                    title="Open this call: transcript and recording"
                  >
                    <td>
                      <b className="flex items-center gap-1.5 truncate">
                        {c.call_ref}
                        {c.recording_url && (
                          <span className="rec-badge" title="This call was recorded: open it to listen">
                            Rec
                          </span>
                        )}
                      </b>
                      <small className="block text-ink-soft">{friendlyTime(c.started_at || c.created_at, true)}</small>
                      <small className="block text-ink-muted">{formatLength(c.duration_seconds)}</small>
                    </td>
                    <td>
                      <CallerCell call={c} />
                    </td>
                    <td className="overflow-hidden">
                      <LanguageBadge language={c.language} />
                    </td>
                    <td>
                      <IntentBadge intent={c.intent} />
                      {c.outcome && <p className="mt-1.5 break-words text-[13px] text-ink-soft">{c.outcome}</p>}
                    </td>
                    <td>
                      <BookingLink status={c.booking_status} callId={c.id} />
                    </td>
                    <td className="break-words text-[13px] text-ink-soft">{c.next_action || '—'}</td>
                    <td>
                      <Link
                        to="/calls/$id"
                        params={{ id: String(c.id) }}
                        search={{ from: 'calls' }}
                        className="btn sm"
                        onClick={(e) => e.stopPropagation()}
                        title={c.recording_url ? 'Transcript and recording' : 'Transcript'}
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > 0 && (
          <Pagination
            paged={{
              page,
              setPage,
              totalPages: pages,
              total,
              from: (page - 1) * PAGE_SIZE + 1,
              to: Math.min(page * PAGE_SIZE, total),
            }}
            noun={`calls ${RANGE_WORDS[range]}${isFetching ? ' · updating…' : ''}`.trim()}
          />
        )}
      </div>
    </div>
  )
}

function CallerCell({ call }: { call: Call }) {
  const name = callerName(call) || 'Unknown caller'
  // The name heard on this call, when the saved patient name is spelled differently
  const said = call.patient_saved_name && call.patient_name && call.patient_saved_name.toLowerCase() !== call.patient_name.toLowerCase() ? call.patient_name : null
  return (
    <div className="who min-w-0 !items-start">
      <Avatar name={name} size={28} />
      <div className="min-w-0">
        <b className={`person-name ${name.length > 22 ? 'long' : ''}`}>{name}</b>
        {said && <span className="said-as">Name said on the call: {said}</span>}
        <small className="block break-words">
          {call.phone_number || 'No number'}
          {call.channel === 'browser' ? ' · test' : ''}
        </small>
      </div>
    </div>
  )
}
