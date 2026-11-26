import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { usePatients } from '../hooks/usePatients'
import { INTENT_LABELS, LANGUAGE_LABELS } from '../hooks/useCalls'
import { PageHeader, Avatar, EmptyState, ErrorState, TableSkeleton, Pagination, paginate, friendlyTime, formatDate, utcDate } from '../components/ui'
import { PatientFormModal } from '../components/PatientForm'
import { Icon } from '../components/Icon'
import { useListState, useScrollMemory } from '../lib/backNav'

export function PatientListPage() {
  const navigate = useNavigate()
  // Search and page: kept while a patient is open, so "All patients" brings the list back as it was
  const { state: view, set, restored } = useListState('/patients', { q: '', page: 1 })
  const { q, page } = view
  const setQ = (v: string) => set('q', v)
  const setPage = (v: number) => set('page', v)
  const [term, setTerm] = useState(q.trim())
  const lastQ = useRef(q)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    if (lastQ.current === q) return
    lastQ.current = q
    const t = window.setTimeout(() => {
      setTerm(q.trim())
      setPage(1)
    }, 300)
    return () => window.clearTimeout(t)
  }, [q])

  const { data, isLoading, error, refetch } = usePatients(term)
  useScrollMemory('/patients', restored, !!data)
  const list = data || []
  const paged = paginate(list, page, setPage, 20)

  return (
    <div>
      <PageHeader
        title="Patients"
        subtitle="Everyone who has called the clinic and given their name, plus anyone staff added"
        actions={
          <>
            <input className="field !h-[34px] !w-60" placeholder="Search name or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search patients" />
            <button className="btn p" onClick={() => setAdding(true)}>
              <Icon name="plus" className="h-4 w-4" /> Add patient
            </button>
          </>
        }
      />

      <div className="card">
        {isLoading ? (
          <TableSkeleton rows={8} />
        ) : error ? (
          <div className="p-4">
            <ErrorState text="Could not load patients" onRetry={() => refetch()} />
          </div>
        ) : list.length === 0 ? (
          <EmptyState icon="users" text={term ? `No patient matches “${term}”.` : 'No patients yet. Callers appear here after their first call.'} />
        ) : (
          <div className="scroll">
            <table className="t">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Language</th>
                  <th>Calls</th>
                  <th>Last call</th>
                  <th>Open appointments</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {paged.pageItems.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="who">
                        <Avatar name={p.name} size={34} />
                        <div>
                          <b>{p.name}</b>
                          <small>
                            {p.phone_number} · since {formatDate(utcDate(p.created_at).toISOString())}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td>{LANGUAGE_LABELS[p.preferred_language] || p.preferred_language}</td>
                    <td className="font-bold">{p.call_count}</td>
                    <td className="whitespace-nowrap">
                      {p.last_call_at ? friendlyTime(p.last_call_at, true) : '—'}
                      {p.last_call_intent && <small className="block text-ink-muted">{INTENT_LABELS[p.last_call_intent] || p.last_call_intent}</small>}
                    </td>
                    <td>{p.open_appointments ? <span className="pill violet">{p.open_appointments}</span> : '—'}</td>
                    <td>
                      <Link to="/patients/$id" params={{ id: String(p.id) }} search={{ from: 'patients' }} className="btn !px-5">
                        View
                        <Icon name="chevronRight" className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!isLoading && <Pagination paged={paged} noun="patients" />}
      </div>

      {adding && <PatientFormModal open onClose={() => setAdding(false)} onSaved={(p) => navigate({ to: '/patients/$id', params: { id: String(p.id) } })} />}
    </div>
  )
}
