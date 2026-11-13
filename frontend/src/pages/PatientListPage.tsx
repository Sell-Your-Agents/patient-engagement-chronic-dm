import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useInitiateCall } from '../hooks/usePatients'
import { usePatientRoster, careTone, type CareStatus } from '../hooks/usePatientRoster'
import { Icon } from '../components/Icon'
import { PageHeader, Kpi, Loader, ErrorState, EmptyState, Avatar, Spinner, friendlyTime, paginate, Pagination } from '../components/ui'
import { PatientFormModal } from '../components/PatientForm'
import { toast, errorText } from '../components/toast'

const FILTERS: (CareStatus | 'All')[] = ['All', 'Stable', 'Needs review', 'Escalated', 'Inactive']

export function PatientListPage() {
  const navigate = useNavigate()
  const { rows, isLoading, error, refetch } = usePatientRoster()
  const { mutate: initiateCall } = useInitiateCall()
  const [filter, setFilter] = useState<CareStatus | 'All'>('All')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [calling, setCalling] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)

  if (isLoading) return <Loader text="Loading patients…" />
  if (error) return <ErrorState text="Could not load patients" onRetry={() => refetch()} />

  const count = (s: CareStatus) => rows.filter((r) => r.status === s).length
  const term = q.trim().toLowerCase()
  const list = rows.filter(
    (r) =>
      (filter === 'All' || r.status === filter) &&
      (!term || r.name.toLowerCase().includes(term) || r.patient.mrn.toLowerCase().includes(term) || r.patient.phone_number.includes(term)),
  )
  const paged = paginate(list, page, setPage, 10)
  const open = (id: number) => navigate({ to: '/patients/$id', params: { id: String(id) } })

  const call = (id: number, name: string) => {
    setCalling(id)
    initiateCall(
      { patient_id: id },
      {
        onSuccess: () => toast.success('Calling now', `The agent is calling ${name}`),
        onError: (err) => toast.error(`Could not call ${name}`, errorText(err, 'Please try again.')),
        onSettled: () => setCalling(null),
      },
    )
  }

  return (
    <div>
      <PageHeader
        title="Patients"
        subtitle={`${rows.length} enrolled patients · click a row to open the patient dashboard`}
        actions={
          <>
            <div className="relative">
              <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
              <input
                className="field !h-9 !w-60 !pl-9"
                placeholder="Filter by name, MRN or phone"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  setPage(1)
                }}
              />
            </div>
            <button className="btn p !h-9" onClick={() => setAdding(true)}>
              <Icon name="plus" className="h-4 w-4" /> Add patient
            </button>
          </>
        }
      />

      <div className="grid g4 mb-3.5">
        <Kpi label="Total patients" value={rows.length} hint={`${rows.filter((r) => r.patient.status === 'active').length} active`} icon="users" tone="a" />
        <Kpi label="Stable" value={count('Stable')} hint="Within targets" icon="checkCircle" tone="ok" />
        <Kpi label="Needs review" value={count('Needs review')} hint="Missed doses or warning signs" icon="clock" tone="warn" />
        <Kpi label="Escalated" value={count('Escalated')} valueTone={count('Escalated') ? 'bad' : undefined} hint="With a clinician" icon="alert" tone="bad" />
      </div>

      <div className="tabs mb-3">
        {FILTERS.map((f) => (
          <button
            key={f}
            className={`tab ${filter === f ? 'on' : ''}`}
            onClick={() => {
              setFilter(f)
              setPage(1)
            }}
          >
            {f}
            <span className="c">{f === 'All' ? rows.length : count(f)}</span>
          </button>
        ))}
      </div>

      <div className="card">
        {/* Fits the page width: less important columns drop out on narrow screens instead of scrolling sideways */}
        <table className="t">
          <thead>
            <tr>
              <th>Patient</th>
              <th>Condition</th>
              <th className="hidden xl:table-cell">Consulting doctor</th>
              <th>Status</th>
              <th className="hidden 2xl:table-cell">Last call</th>
              <th className="hidden xl:table-cell">Next check-in</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paged.pageItems.map((r) => (
              <tr key={r.patient.id} className="rowbtn" onClick={() => open(r.patient.id)}>
                <td>
                  <div className="who">
                    <Avatar name={r.name} />
                    <div className="min-w-0">
                      <b className="truncate">{r.name}</b>
                      <small>
                        {r.patient.mrn} · {r.patient.phone_number}
                      </small>
                    </div>
                  </div>
                </td>
                <td>
                  {r.primaryPlan ? (
                    <>
                      <b className="block">{r.primaryPlan.condition}</b>
                      <small className="capitalize text-ink-muted">
                        {r.primaryPlan.severity || '—'}
                        {r.plans.length > 1 ? ` · +${r.plans.length - 1} more` : ''}
                      </small>
                    </>
                  ) : (
                    <span className="text-ink-muted">No care plan</span>
                  )}
                </td>
                <td className="hidden xl:table-cell">{r.primaryPlan?.assigned_physician_name || <span className="text-ink-muted">—</span>}</td>
                <td>
                  <span className={`pill ${careTone(r.status)} dotted`}>{r.status}</span>
                </td>
                <td className="hidden whitespace-nowrap text-ink-soft 2xl:table-cell">{r.lastCall ? friendlyTime(r.lastCall.started_at || r.lastCall.created_at, true) : '—'}</td>
                <td className="hidden whitespace-nowrap xl:table-cell">{r.primaryPlan ? friendlyTime(r.primaryPlan.next_due_date, true) : '—'}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-1.5">
                    <button className="btn sm p" disabled={calling === r.patient.id} onClick={() => call(r.patient.id, r.name)}>
                      {calling === r.patient.id ? <Spinner /> : <Icon name="phone" className="h-3.5 w-3.5" />} Call
                    </button>
                    <button className="btn sm" onClick={() => open(r.patient.id)}>
                      View
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && <EmptyState icon="users" text="No patients match this filter." />}
        <Pagination paged={paged} noun="patients" />
      </div>

      {adding && <PatientFormModal open onClose={() => setAdding(false)} onSaved={(p) => p?.id && open(p.id)} />}
    </div>
  )
}
