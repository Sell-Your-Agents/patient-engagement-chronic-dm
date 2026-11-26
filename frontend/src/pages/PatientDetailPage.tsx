import { useState } from 'react'
import { Link, useParams, useSearch } from '@tanstack/react-router'
import { backTarget } from '../lib/backNav'
import { usePatient, usePatientFollowUps } from '../hooks/usePatients'
import { useCallPage, INTENT_LABELS, LANGUAGE_LABELS } from '../hooks/useCalls'
import { useAppointments } from '../hooks/useAppointments'
import { followUpOutcome, countFollowUpRows } from '../hooks/useFollowUps'
import { PageHeader, Panel, Loader, ErrorState, EmptyState, Avatar, friendlyTime, plainTime, formatDateTime, formatDate, formatLength, utcDate } from '../components/ui'
import { AppointmentStatusBadge } from '../components/clinic'
import { PatientFormModal } from '../components/PatientForm'
import { MoreText } from '../components/MoreText'
import { Icon, type IconName } from '../components/Icon'

type Filter = 'all' | 'calls' | 'appointments' | 'followups'

type Entry = {
  key: string
  kind: Exclude<Filter, 'all'>
  /** UTC ms, for sorting newest first */
  at: number
  when: string
  icon: IconName
  title: string
  detail: string
  right: React.ReactNode
}

/** One person's whole story: who they are, what is still open, and a single timeline of calls, appointments and follow-ups. */
export function PatientDetailPage() {
  const { id } = useParams({ from: '/patients/$id' })
  // Opened from another page (Follow-ups, a call): back goes there; otherwise to the patient list
  const { from } = useSearch({ from: '/patients/$id' })
  const patientId = Number(id)
  const [editing, setEditing] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const { data: p, isLoading, error, refetch } = usePatient(patientId)
  const { data: calls } = useCallPage({ page: 1, page_size: 100, patient_id: patientId })
  const { data: appointments } = useAppointments({ patient_id: patientId })
  const { data: followUps } = usePatientFollowUps(patientId)

  if (isLoading) return <Loader text="Loading patient…" variant="detail" />
  if (error || !p) return <ErrorState text="Could not load this patient" onRetry={() => refetch()} />

  // Only counts here: staff act on these on the Appointments and Follow-ups pages
  const pendingAppointments = (appointments || []).filter((a) => a.status === 'pending').length
  // Counted like the Follow-ups page (one row per call), so the number matches what the link shows
  const openFollowUps = countFollowUpRows((followUps || []).filter((f) => f.status === 'pending'))

  // ---- Timeline: calls, appointments and follow-ups together, newest first ----
  const entries: Entry[] = []
  for (const c of calls?.items || []) {
    entries.push({
      key: `c${c.id}`,
      kind: 'calls',
      at: utcDate(c.started_at || c.created_at).getTime(),
      when: friendlyTime(c.started_at || c.created_at, true),
      icon: 'phone',
      title: `Call ${c.call_ref}${c.intent ? ` · ${INTENT_LABELS[c.intent] || c.intent}` : ''}`,
      detail: [c.summary || c.outcome || (c.status === 'in-progress' ? 'Live now' : 'No summary'), c.duration_seconds ? formatLength(c.duration_seconds) : '']
        .filter(Boolean)
        .join(' · '),
      right: (
        <Link to="/calls/$id" params={{ id: String(c.id) }} search={{ from: `patient-${p.id}` }} className={`btn sm ${c.status === 'in-progress' ? '!border-ok !bg-ok !text-white' : ''}`}>
          {c.status === 'in-progress' ? 'Watch live' : 'View'}
        </Link>
      ),
    })
  }
  for (const a of appointments || []) {
    entries.push({
      key: `a${a.id}`,
      kind: 'appointments',
      at: utcDate(a.created_at).getTime(),
      when: friendlyTime(a.created_at, true),
      icon: 'calendar',
      title: `Appointment · ${a.doctor_id ? a.doctor_name : a.doctor_requested || 'doctor not chosen'}`,
      detail: [a.start_at ? formatDateTime(a.start_at) : a.preferred_time ? `Asked for ${plainTime(a.preferred_time)}` : 'No time yet', a.reason].filter(Boolean).join(' · '),
      right: <AppointmentStatusBadge status={a.status} />,
    })
  }
  for (const f of followUps || []) {
    if (f.kind === 'confirm_appointment') continue // shown as its appointment
    entries.push({
      key: `f${f.id}`,
      kind: 'followups',
      at: utcDate(f.created_at).getTime(),
      when: friendlyTime(f.created_at, true),
      icon: 'phoneCall',
      title: `Follow-up · ${followUpOutcome(f)}`,
      detail: [f.reason, f.staff_notes ? `Note: ${f.staff_notes}` : ''].filter(Boolean).join(' · ') || '—',
      right: (
        <span className={`pill ${f.status === 'pending' ? 'warn' : f.status === 'done' ? 'ok' : 'mute'}`}>
          {f.status === 'pending' ? 'To do' : f.status === 'done' ? 'Done' : 'Closed'}
        </span>
      ),
    })
  }
  entries.sort((x, y) => y.at - x.at)
  const shown = filter === 'all' ? entries : entries.filter((e) => e.kind === filter)
  const lastCall = calls?.items?.[0]

  return (
    <div className="lg:flex lg:h-[calc(100dvh-70px)] lg:flex-col">
      <PageHeader title={p.name} back={backTarget(from, { to: '/patients', label: 'All patients' })} />

      {/* Who they are */}
      <div className="card mb-3.5 flex shrink-0 flex-wrap items-center gap-4 p-4">
        <Avatar name={p.name} size={52} />
        <div className="min-w-0 flex-1">
          <b className="block truncate text-[18px]">{p.name}</b>
          <span className="text-[13px] text-ink-soft">
            {p.phone_number} · Patient since {formatDate(utcDate(p.created_at).toISOString())}
          </span>
          {(pendingAppointments > 0 || openFollowUps > 0) && (
            <span className="mt-1 flex flex-wrap gap-2 text-[12.5px] font-bold">
              {pendingAppointments > 0 && (
                <Link to="/appointments" search={{ patient: p.id, from: `patient-${p.id}` }} className="pill warn hover:underline" title="Show only this patient's pending appointments">
                  {pendingAppointments} appointment{pendingAppointments === 1 ? '' : 's'} pending →
                </Link>
              )}
              {openFollowUps > 0 && (
                <Link to="/follow-ups" search={{ patient: p.id, from: `patient-${p.id}` }} className="pill warn hover:underline" title="Show only this patient's follow-ups">
                  {openFollowUps} follow-up{openFollowUps === 1 ? '' : 's'} to do →
                </Link>
              )}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Stat label="Saved language" value={LANGUAGE_LABELS[p.preferred_language] || p.preferred_language} />
          <Stat label="Calls" value={String(p.call_count)} />
          <Stat label="Last call" value={lastCall ? friendlyTime(lastCall.started_at || lastCall.created_at, true) : '—'} />
        </div>
        <button className="btn" onClick={() => setEditing(true)}>
          <Icon name="edit" className="h-4 w-4" /> Edit
        </button>
        {p.notes && <p className="w-full text-[13px] text-ink-soft">Note: {p.notes}</p>}
      </div>

      <div className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
        {/* Everything that happened */}
        <Panel
          className="flex min-h-0 min-w-0 flex-col lg:flex-1"
          title="Timeline"
          subtitle="Calls, appointments and follow-ups, newest first"
          right={
            <div className="tabs">
              {(
                [
                  ['all', 'All'],
                  ['calls', 'Calls'],
                  ['appointments', 'Appointments'],
                  ['followups', 'Follow-ups'],
                ] as const
              ).map(([k, l]) => (
                <button key={k} className={`tab ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
                  {l}
                </button>
              ))}
            </div>
          }
        >
          {shown.length === 0 ? (
            <EmptyState icon="clock" text="Nothing here yet." />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {shown.map((e) => (
                <div key={e.key} className="flex items-center gap-3 border-t border-line-soft px-4 py-2.5">
                  <span className="w-[112px] shrink-0 truncate text-[12px] text-ink-muted">{e.when}</span>
                  <span className="ico a !h-7 !w-7 shrink-0">
                    <Icon name={e.icon} className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <b className="block truncate text-[13.5px]">{e.title}</b>
                    <div className="text-[12.5px] text-ink-soft">
                      <MoreText text={e.detail} limit={90} />
                    </div>
                  </div>
                  <div className="flex w-[170px] shrink-0 justify-end">{e.right}</div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {editing && <PatientFormModal open patient={p} onClose={() => setEditing(false)} />}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] border border-line-soft bg-card-2 px-3 py-1.5">
      <span className="lbl !text-[10px]">{label}</span>
      <b className="block text-[13px]">{value}</b>
    </div>
  )
}
