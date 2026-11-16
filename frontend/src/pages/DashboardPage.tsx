import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useKpis } from '../hooks/useKpis'
import { useCalls, useCallbacks, isLiveCall } from '../hooks/useCalls'
import { useEscalations } from '../hooks/useEscalations'
import { useAppointments } from '../hooks/useAppointments'
import { usePatients } from '../hooks/usePatients'
import { useDoctors, useDoctorAvailability, useClinicInfo, type Doctor } from '../hooks/useClinic'
import { useDiseasesOverview } from '../hooks/useDiseases'
import { Icon } from '../components/Icon'
import { PageHeader, Kpi, Panel, Loader, ErrorState, EmptyState, SeverityBadge, StatusBadge, Avatar, friendlyTime, formatTime, utcDate } from '../components/ui'
import { localISODate, mondayIndex, hhmmTo12h } from '../components/clinic'

const PREVIEW = 3

/** Footer button that expands a panel's list to everything or back to the preview. */
function ShowMore({ total, open, onToggle, noun }: { total: number; open: boolean; onToggle: () => void; noun: string }) {
  if (total <= PREVIEW) return null
  return (
    <button className="more" onClick={onToggle}>
      {open ? 'Show less' : `Show all ${total} ${noun}`}
      <Icon name="chevronDown" className={`h-4 w-4 transition ${open ? 'rotate-180' : ''}`} />
    </button>
  )
}

const SEV_ORDER: Record<string, number> = { urgent: 0, critical: 0, high: 1, medium: 2, low: 3 }

/** Local midnight for each of the last n days, oldest first. */
function lastDays(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - (n - 1 - i))
    return d
  })
}

export function DashboardPage() {
  const navigate = useNavigate()
  const { data: kpis, isLoading, error, refetch } = useKpis()
  const { data: calls } = useCalls()
  const { data: callbacks } = useCallbacks()
  const { data: escalations } = useEscalations()
  const { data: patients } = usePatients(0, 100)
  const { data: doctors } = useDoctors()
  const { data: diseases } = useDiseasesOverview()
  const today = localISODate(new Date())
  const { data: appts } = useAppointments({ date_from: today })
  const [showAll, setShowAll] = useState({ esc: false, appts: false, docs: false })
  const toggle = (k: keyof typeof showAll) => setShowAll((s) => ({ ...s, [k]: !s[k] }))

  if (isLoading) return <Loader text="Loading dashboard…" variant="dashboard" />
  if (error || !kpis) return <ErrorState text="Could not load the dashboard" onRetry={() => refetch()} />

  const patientName = (id: number | null) => {
    if (id === null) return 'New caller'
    const p = patients?.find((x) => x.id === id)
    return p ? `${p.first_name} ${p.last_name}` : `Patient ${id}`
  }

  // Daily series for the sparklines
  const days = lastDays(7)
  const keyOf = (v: string) => localISODate(utcDate(v))
  const allCalls = calls || []
  const week = days.map((d) => {
    const k = localISODate(d)
    const dayCalls = allCalls.filter((c) => keyOf(c.started_at || c.created_at) === k)
    return {
      n: dayCalls.length,
      done: dayCalls.filter((c) => c.status === 'completed').length,
      esc: (escalations || []).filter((e) => keyOf(e.created_at) === k).length,
    }
  })
  const weekTotal = week.reduce((a, w) => a + w.n, 0)

  const openEsc = (escalations || [])
    .filter((e) => e.status !== 'resolved')
    .sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9) || b.created_at.localeCompare(a.created_at))
  const urgent = openEsc.filter((e) => e.severity === 'urgent').length

  const due = (callbacks || []).filter((c) => c.status === 'pending' && new Date(c.scheduled_time).getTime() <= Date.now()).sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time))
  const live = allCalls.filter(isLiveCall).length

  const todays = (appts || [])
    .filter((a) => a.start_at && localISODate(new Date(a.start_at)) === today && a.status !== 'cancelled')
    .sort((a, b) => (a.start_at || '').localeCompare(b.start_at || ''))
  const toConfirm = todays.filter((a) => a.status === 'requested').length
  const conditionCount = (diseases || []).length
  const dayIdx = mondayIndex(new Date())
  const onDuty = (doctors || []).filter((d) => d.is_active && d.working_days.includes(dayIdx))
  const offDuty = (doctors || []).filter((d) => !(d.is_active && d.working_days.includes(dayIdx)))
  const doctorCount = new Set(todays.map((a) => a.doctor_id)).size

  return (
    <div>
      <PageHeader title="Dashboard" />

      <div className="strip">
        <span className="live">
          <i className="dot" /> LIVE
        </span>
        <div className="seg">
          <Icon name="phone" className="h-[18px] w-[18px]" />
          <span>
            <b>{live}</b> call{live === 1 ? '' : 's'} in progress
          </span>
        </div>
        <i className="sep" />
        <div className="seg">
          <Icon name="clock" className="h-4 w-4" />
          <span>
            <b>{due.length}</b> callback{due.length === 1 ? '' : 's'} due now
            {due[0] ? ` · ${due[0].patient_name || due[0].phone_number}, ${formatTime(due[0].scheduled_time)}` : ''}
          </span>
        </div>
        <i className="sep" />
        <div className="seg">
          <Icon name="alert" className="h-[18px] w-[18px]" />
          <span>
            <b>{urgent}</b> urgent escalation{urgent === 1 ? '' : 's'} awaiting a clinician
          </span>
        </div>
        <Link to="/escalations" className="btn">
          Open queue →
        </Link>
      </div>

      <div className="grid g5 mb-3.5">
        <Kpi to="/patients" label="Enrolled patients" value={kpis.total_patients_enrolled} hint={`${conditionCount} chronic condition${conditionCount === 1 ? '' : 's'}`} icon="users" tone="a" />
        <Kpi to="/calls" label="Calls this week" value={weekTotal} hint={`${kpis.total_outreach_calls} outreach calls overall`} icon="phone" tone="a" trend={week.map((w) => w.n)} />
        <Kpi to="/calls" label="Completion rate" value={`${Math.round(kpis.call_completion_rate)}%`} hint="Answered and finished" icon="trending" tone="ok" dir="up" trend={week.map((w) => w.done)} />
        <Kpi
          to="/escalations"
          label="Open escalations"
          value={openEsc.length}
          valueTone={openEsc.length ? 'bad' : undefined}
          hint={`${urgent} urgent`}
          dir={urgent ? 'dn' : undefined}
          icon="alert"
          tone="bad"
          trend={week.map((w) => w.esc)}
        />
        <Kpi to="/appointments" label="Appointments today" value={todays.length} hint={`${toConfirm} request${toConfirm === 1 ? '' : 's'} to confirm`} icon="calendar" tone="violet" />
      </div>

      <div className="grid g3 mb-3.5">
        <Panel
          className="panel-col"
          title="Needs attention"
          subtitle="Open escalations, most severe first"
          right={
            <Link to="/escalations" className="btn sm">
              Open queue
            </Link>
          }
        >
          {openEsc.length === 0 ? (
            <EmptyState icon="checkCircle" text="All clear. No escalations need action." />
          ) : (
            <ul className={`list ${showAll.esc ? 'list-scroll' : ''}`}>
              {openEsc.slice(0, showAll.esc ? undefined : PREVIEW).map((e) => (
                <li key={e.id} className="rowbtn !items-start" onClick={() => navigate({ to: '/escalations/$id', params: { id: String(e.id) } })}>
                  <SeverityBadge severity={e.severity} fixed />
                  <span className="min-w-0 flex-1">
                    <b className="block truncate">{patientName(e.patient_id)}</b>
                    <span className="line-clamp-2 text-[13px] text-ink-soft">{e.reason}</span>
                    <small className="mt-0.5 block text-[11.5px] text-ink-muted">
                      {friendlyTime(e.created_at, true)}
                      {e.status === 'acknowledged' ? ' · acknowledged' : ''}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <ShowMore total={openEsc.length} open={showAll.esc} onToggle={() => toggle('esc')} noun="escalations" />
        </Panel>

        <Panel
          className="panel-col"
          title="Today’s schedule"
          subtitle={`${todays.length} appointment${todays.length === 1 ? '' : 's'} across ${doctorCount} doctor${doctorCount === 1 ? '' : 's'}`}
          right={
            <Link to="/appointments" className="btn sm">
              All
            </Link>
          }
        >
          {todays.length === 0 ? (
            <EmptyState icon="calendar" text="No appointments today." />
          ) : (
            <div className={`px-[18px] pb-3.5 pt-1 ${showAll.appts ? 'list-scroll' : ''}`}>
              <div className="tl">
                {todays.slice(0, showAll.appts ? undefined : PREVIEW).map((a) => (
                  <div key={a.id} className="contents">
                    <div className="t">{formatTime(a.start_at)}</div>
                    <div className={`e ${a.status === 'confirmed' || a.status === 'completed' ? 'done' : a.status === 'requested' ? 'wait' : ''}`}>
                      <b>{a.patient_name}</b>
                      <small>
                        {a.doctor_name}
                        {a.reason ? ` · ${a.reason}` : ''}
                      </small>
                      <div className="mt-1">
                        <StatusBadge status={a.status} dotted={false} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <ShowMore total={todays.length} open={showAll.appts} onToggle={() => toggle('appts')} noun="appointments" />
        </Panel>

        <Panel
          className="panel-col"
          title="Doctors on duty"
          subtitle="Next free slot"
          right={
            <Link to="/doctors" className="btn sm">
              Roster
            </Link>
          }
        >
          {(doctors || []).length === 0 ? (
            <EmptyState icon="stethoscope" text="No doctors configured." />
          ) : (
            <ul className={`list ${showAll.docs ? 'list-scroll' : ''}`}>
              {onDuty.slice(0, showAll.docs ? undefined : PREVIEW).map((d) => (
                <DoctorRow key={d.id} doctor={d} />
              ))}
              {(showAll.docs ? offDuty : offDuty.slice(0, Math.max(0, PREVIEW - onDuty.length))).map((d) => (
                <li key={d.id} className="opacity-60">
                  <Avatar name={d.name} />
                  <span className="min-w-0 flex-1">
                    <b className="block truncate">{d.name}</b>
                    <span className="block truncate text-[12.5px] text-ink-muted">{d.specialty}</span>
                  </span>
                  <span className="pill mute">Off today</span>
                </li>
              ))}
            </ul>
          )}
          <ShowMore total={(doctors || []).length} open={showAll.docs} onToggle={() => toggle('docs')} noun="doctors" />
        </Panel>
      </div>

      <AboutPatientPulse conditions={(diseases || []).map((d) => d.display_name)} />
    </div>
  )
}

function DoctorRow({ doctor }: { doctor: Doctor }) {
  const { data: slots } = useDoctorAvailability(doctor.id, 7)
  const next = slots?.[0]
  return (
    <li>
      <Avatar name={doctor.name} />
      <span className="min-w-0 flex-1">
        <b className="block truncate">{doctor.name}</b>
        <span className="block truncate text-[12.5px] text-ink-muted">
          {doctor.specialty} · {hhmmTo12h(doctor.start_time)} – {hhmmTo12h(doctor.end_time)}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="pill ok dotted">On duty</span>
        <br />
        <small className="text-ink-muted">{next ? friendlyTime(next) : slots ? 'Fully booked' : '…'}</small>
      </span>
    </li>
  )
}

/* ------------------------------------------------------------------ */
/* About section                                                      */
/* ------------------------------------------------------------------ */

const STEPS = [
  { title: 'Check-in call', text: 'The agent calls each patient on their care-plan schedule.' },
  { title: 'Health questions', text: 'Readings, symptoms and medicines, in the patient’s language.' },
  { title: 'Red-flag check', text: 'Warning signs raise an escalation for a clinician.' },
  { title: 'Follow-up', text: 'Books a visit or schedules a callback, then logs the call.' },
]

function AboutPatientPulse({ conditions }: { conditions: string[] }) {
  const { data: info } = useClinicInfo()
  const agent = info?.agent_name || 'The agent'
  return (
    <div className="card about">
      <div className="copy">
        <div className="lbl !text-brand">About PatientPulse</div>
        <h2>An AI care assistant that keeps chronic patients on track between visits</h2>
        <p className="lead">
          {agent} phones patients living with long-term conditions on a regular schedule, asks about their readings, symptoms and medicines, and
          explains their care in plain words. When something sounds wrong, it flags the patient to the care team straight away. Patients can also call
          the clinic number to book a visit or ask a question.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {(conditions.length ? conditions : ['Type 2 Diabetes', 'Hypertension', 'COPD', 'Asthma']).map((c) => (
            <span key={c} className="pill acc">
              {c}
            </span>
          ))}
        </div>
        <div className="lbl mt-1">How a check-in works</div>
        <div className="steps">
          {STEPS.map((s, i) => (
            <div key={s.title} className="step">
              <span className="n">{i + 1}</span>
              <b>{s.title}</b>
              <small>{s.text}</small>
            </div>
          ))}
        </div>
      </div>

      <div className="art" aria-hidden="true">
        <div className="tile">
          <BookingArt />
          <b>Callbacks &amp; bookings</b>
          <small>Books doctor visits and calls patients back at the time they ask for.</small>
        </div>
        <div className="tile">
          <GlucoseArt />
          <b>Sugar &amp; BP readings</b>
          <small>Records fasting sugar and blood pressure from each call.</small>
        </div>
        <div className="tile">
          <InhalerArt />
          <b>Breathing checks</b>
          <small>Tracks breathlessness and rescue-inhaler use for COPD and asthma.</small>
        </div>
        <div className="tile">
          <HeartArt />
          <b>Warning signs</b>
          <small>Urgent symptoms reach a clinician in minutes, not days.</small>
        </div>
      </div>
    </div>
  )
}

/* Simple theme-aware illustrations (drawn, not photos) */

function BookingArt() {
  return (
    <svg viewBox="0 0 200 92">
      <rect x="0" y="0" width="200" height="92" rx="10" fill="var(--accent-bg)" />
      {/* calendar with a booked slot */}
      <rect x="30" y="16" width="70" height="62" rx="9" fill="var(--card)" stroke="var(--accent)" strokeWidth="2.5" />
      <path d="M30 34h70" stroke="var(--accent)" strokeWidth="2.5" />
      <path d="M48 10v12M82 10v12" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" />
      <rect x="40" y="42" width="12" height="10" rx="2.5" fill="var(--line)" />
      <rect x="59" y="42" width="12" height="10" rx="2.5" fill="var(--accent)" />
      <rect x="78" y="42" width="12" height="10" rx="2.5" fill="var(--line)" />
      <rect x="40" y="58" width="12" height="10" rx="2.5" fill="var(--line)" />
      <rect x="59" y="58" width="12" height="10" rx="2.5" fill="var(--line)" />
      <path d="M62 47l2.5 2.5 4.5-5" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* phone with a callback arrow */}
      <rect x="124" y="20" width="44" height="54" rx="10" fill="var(--card)" stroke="var(--violet)" strokeWidth="2.5" />
      <path d="M153 50v3a2.4 2.4 0 0 1-2.6 2.4 23.6 23.6 0 0 1-10.3-3.7 23 23 0 0 1-7.1-7.1 23.6 23.6 0 0 1-3.7-10.3A2.4 2.4 0 0 1 131.7 32h3a2.4 2.4 0 0 1 2.4 2c.1 1.1.4 2.2.8 3.3a2.4 2.4 0 0 1-.5 2.5l-1.3 1.3a19 19 0 0 0 7.1 7.1l1.3-1.3a2.4 2.4 0 0 1 2.5-.5c1.1.4 2.2.7 3.3.8a2.4 2.4 0 0 1 2 2.4z" fill="none" stroke="var(--violet)" strokeWidth="2" strokeLinejoin="round" />
      <path d="M176 30a14 14 0 0 1 0 22" fill="none" stroke="var(--violet)" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M172 52l4 1 1-4" fill="none" stroke="var(--violet)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function GlucoseArt() {
  return (
    <svg viewBox="0 0 200 92">
      <rect x="0" y="0" width="200" height="92" rx="10" fill="var(--info-bg)" />
      <rect x="28" y="14" width="56" height="66" rx="12" fill="var(--card)" stroke="var(--info)" strokeWidth="2.5" />
      <rect x="37" y="23" width="38" height="24" rx="5" fill="var(--info-bg)" />
      <text x="56" y="40" textAnchor="middle" fontSize="12" fontWeight="900" fill="var(--info)" fontFamily="Lato, sans-serif">
        142
      </text>
      <circle cx="56" cy="62" r="7" fill="var(--info)" />
      <rect x="84" y="40" width="22" height="6" rx="3" fill="var(--info)" />
      <polyline points="116,62 132,50 146,56 162,34 178,40" fill="none" stroke="var(--bad)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="178" cy="40" r="4" fill="var(--bad)" />
    </svg>
  )
}

function InhalerArt() {
  return (
    <svg viewBox="0 0 200 92">
      <rect x="0" y="0" width="200" height="92" rx="10" fill="var(--ok-bg)" />
      <rect x="58" y="10" width="30" height="50" rx="8" fill="var(--card)" stroke="var(--ok)" strokeWidth="2.5" />
      <path d="M52 58h44v14a6 6 0 0 1-6 6H76l-8 8H58a6 6 0 0 1-6-6z" fill="var(--ok)" />
      <path d="M110 34c14 0 14 10 28 10s14-10 28-10" fill="none" stroke="var(--ok)" strokeWidth="2.5" strokeLinecap="round" opacity=".7" />
      <path d="M110 50c14 0 14 10 28 10s14-10 28-10" fill="none" stroke="var(--ok)" strokeWidth="2.5" strokeLinecap="round" opacity=".45" />
    </svg>
  )
}

function HeartArt() {
  return (
    <svg viewBox="0 0 200 92">
      <rect x="0" y="0" width="200" height="92" rx="10" fill="var(--bad-bg)" />
      <path d="M62 76s-30-17-30-38a16 16 0 0 1 30-8 16 16 0 0 1 30 8c0 21-30 38-30 38z" fill="var(--card)" stroke="var(--bad)" strokeWidth="2.5" strokeLinejoin="round" />
      <polyline points="36,46 50,46 56,34 64,58 70,46 88,46" fill="none" stroke="var(--bad)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M128 22 L150 62 H106 Z" fill="var(--warn-bg)" stroke="var(--warn)" strokeWidth="2.5" strokeLinejoin="round" />
      <line x1="128" y1="36" x2="128" y2="48" stroke="var(--warn)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="128" cy="55" r="2" fill="var(--warn)" />
      <rect x="160" y="30" width="26" height="26" rx="7" fill="var(--accent)" />
      <path d="M173 36v14M166 43h14" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
