import { Link } from '@tanstack/react-router'
import { useKpis } from '../hooks/useKpis'
import { useAuthStore } from '../store/authStore'
import { Icon, type IconName } from '../components/Icon'
import { PageHeader, StatCard, Loader, ErrorState } from '../components/ui'

const CAPABILITIES = [
  'Call chronic-care patients for routine check-ins',
  'Follow protocols for Diabetes, Hypertension, COPD & Asthma',
  'Detect warning signs and escalate to the care team',
  'Capture medication adherence and patient satisfaction',
  'Log appointment requests and save call transcripts',
]

const FEATURES: { icon: IconName; label: string }[] = [
  { icon: 'globe', label: 'Multi-lingual' },
  { icon: 'wave', label: 'Smart Conversations' },
  { icon: 'shield', label: 'Clinical Escalation' },
]

export function DashboardPage() {
  const { data: kpis, isLoading, error } = useKpis()
  const { user } = useAuthStore()

  if (isLoading) return <Loader text="Loading KPIs..." />
  if (error) return <ErrorState text="Error loading KPIs" />
  if (!kpis) return <ErrorState text="No data" />

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`Welcome back${user?.name ? `, ${user.name}` : ''}! Here's how patient outreach is going.`}
      />

      {/* Enrollment & call performance */}
      <SectionLabel>Enrollment & Call Performance</SectionLabel>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Total Enrolled" value={kpis.total_patients_enrolled} icon="users" tint="peach" />
        <StatCard label="Active Patients" value={kpis.active_patients} icon="activity" tint="sky" />
        <StatCard label="Total Calls" value={kpis.total_outreach_calls} icon="phone" tint="mint" />
        <StatCard label="Completed Calls" value={kpis.completed_calls} icon="checkCircle" tint="lavender" />
        <StatCard label="Completion Rate" value={`${kpis.call_completion_rate}%`} icon="trending" tint="amber" />
      </div>

      {/* Clinical outcomes */}
      <SectionLabel className="mt-5">Clinical Outcomes</SectionLabel>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Engagement Rate" value={`${kpis.engagement_rate}%`} icon="heart" tint="rose" />
        <StatCard
          label="Avg Satisfaction"
          value={kpis.average_csat ? `${kpis.average_csat}/5` : '—'}
          icon="star"
          tint="amber"
        />
        <StatCard label="Medication Adherent" value={kpis.medication_adherent_calls} icon="pill" tint="teal" />
        <StatCard label="Confirmed Appts" value={kpis.confirmed_appointments} icon="calendar" tint="lavender" />
        <StatCard label="Calls With Warnings" value={kpis.calls_with_warnings} icon="alert" tint="coral" />
      </div>

      {/* Active issues */}
      <Link
        to="/escalations"
        className="clay mt-5 flex flex-wrap items-center justify-between gap-4 px-5 py-3 transition hover:-translate-y-0.5"
      >
        <div className="flex items-center gap-4">
          <div className="stat-bubble bubble-coral">
            <Icon name="alert" className="h-5 w-5" />
          </div>
          <div>
            <p className="font-extrabold text-ink">{kpis.open_escalations} Open Escalations</p>
            <p className="text-sm text-ink-soft">Urgent patient cases requiring care team attention</p>
          </div>
        </div>
        <span className="clay-btn-ghost btn-sm">
          View queue <Icon name="chevronRight" className="h-4 w-4" />
        </span>
      </Link>

      {/* About this agent */}
      <div className="clay mt-5 grid grid-cols-1 items-center gap-5 p-4 lg:grid-cols-[1fr_1.15fr] 2xl:grid-cols-[1fr_auto_1.15fr]">
        <div>
          <div className="flex items-center gap-3">
            <div className="stat-bubble bubble-peach">
              <Icon name="bot" className="h-5 w-5" />
            </div>
            <h2 className="text-lg font-extrabold tracking-tight text-ink">About This Agent</h2>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            Your AI health coach makes natural, human-like outreach calls to patients with chronic conditions,
            checks on symptoms and medications, and flags anything that needs the care team's attention.
          </p>
          <div className="mt-3.5 flex flex-wrap gap-2">
            {FEATURES.map((f) => (
              <span
                key={f.label}
                className="clay-sm inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold text-ink"
              >
                <Icon name={f.icon} className="h-3.5 w-3.5 text-orange-500" />
                {f.label}
              </span>
            ))}
          </div>
        </div>

        {/* Clay illustration (wide screens only) */}
        <div className="hidden justify-center 2xl:flex">
          <div className="relative h-32 w-32">
            <div className="tint-sky clay-sm absolute inset-0 rounded-full" />
            <div className="clay-sm absolute inset-5 flex items-center justify-center rounded-full text-orange-500">
              <Icon name="stethoscope" className="h-11 w-11" strokeWidth={1.6} />
            </div>
            <div className="stat-bubble bubble-rose absolute -right-1 top-1 !h-10 !w-10 !rounded-full">
              <Icon name="heart" className="h-4 w-4" />
            </div>
            <div className="stat-bubble bubble-mint absolute -left-1 bottom-1 !h-9 !w-9 !rounded-full">
              <Icon name="phone" className="h-4 w-4" />
            </div>
          </div>
        </div>

        <div className="clay-sm rounded-[20px] p-4">
          <p className="card-title">What can I do?</p>
          <ul className="mt-2.5 grid grid-cols-1 gap-x-5 gap-y-2 md:grid-cols-2">
            {CAPABILITIES.map((c) => (
              <li key={c} className="flex items-start gap-2 text-[13px] leading-snug text-ink-soft">
                <Icon name="checkCircle" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function SectionLabel({ children, className = '' }: { children: string; className?: string }) {
  return (
    <p className={`mb-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-muted ${className}`}>{children}</p>
  )
}
