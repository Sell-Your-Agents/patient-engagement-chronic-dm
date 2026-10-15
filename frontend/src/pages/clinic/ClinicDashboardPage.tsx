import { Link } from '@tanstack/react-router'
import { useClinicInfo, useClinicStats, useClinicAppointments, useClinicCalls, useDoctors } from '../../hooks/useClinic'
import { Icon } from '../../components/Icon'
import { PageHeader, StatCard, Panel, EmptyState, Loader, ErrorState, formatUtcDateTime } from '../../components/ui'
import { OutcomeBadge, hhmmTo12h, initials, localISODate, mondayIndex } from '../../components/clinic'

export function ClinicDashboardPage() {
  const { data: info } = useClinicInfo()
  const { data: stats, isLoading, error } = useClinicStats()
  const today = new Date()
  const { data: upcoming } = useClinicAppointments({ date_from: localISODate(today), status: 'booked' })
  const { data: calls } = useClinicCalls()
  const { data: doctors } = useDoctors()

  if (isLoading) return <Loader text="Loading callback dashboard..." />
  if (error || !stats) return <ErrorState text="Error loading callback dashboard" />

  const now = new Date()
  const nextAppointments = (upcoming || []).filter((a) => new Date(a.end_at) >= now).slice(0, 4)
  const recentCalls = (calls || []).slice(0, 3)
  const onDuty = (doctors || []).filter((d) => d.is_active && d.working_days.includes(mondayIndex(today)))

  return (
    <div>
      <PageHeader
        title="Callback Dashboard"
        subtitle={`${info?.clinic_name ?? 'Clinic'} · ${info?.agent_name ?? 'Agent'} calls back missed callers and books the right doctor.`}
        actions={
          <Link to="/clinic/missed-calls" className="clay-btn">
            <Icon name="phoneMissed" className="h-4 w-4" /> Log Missed Call
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Missed Calls" value={stats.total_missed_calls} icon="phoneMissed" tint="coral" />
        <StatCard label="Pending" value={stats.pending_callbacks} icon="clock" tint="amber" />
        <StatCard label="Callbacks" value={stats.callbacks_made} icon="phoneCall" tint="sky" />
        <StatCard label="Booked" value={stats.appointments_booked} icon="calendar" tint="mint" />
        <StatCard label="Today" value={stats.appointments_today} icon="activity" tint="lavender" />
        <StatCard label="Conversion" value={`${stats.conversion_rate}%`} icon="trending" tint="peach" />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Upcoming appointments */}
        <Panel
          className="xl:col-span-2"
          title="Upcoming Appointments"
          right={
            <Link to="/clinic/appointments" className="clay-btn-ghost btn-sm">
              View all <Icon name="chevronRight" className="h-4 w-4" />
            </Link>
          }
        >
          <table className="clay-table">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Date & Time</th>
                <th className="col-md">Doctor</th>
                <th className="col-2xl">Reason</th>
              </tr>
            </thead>
            <tbody>
              {nextAppointments.map((a) => (
                <tr key={a.id}>
                  <td>
                    <p className="font-bold text-ink">{a.patient_name}</p>
                    <p className="text-xs font-semibold text-ink-soft">{a.phone_number}</p>
                  </td>
                  <td>
                    <p className="font-semibold text-ink">
                      {new Date(a.start_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    </p>
                    <p className="text-xs font-semibold text-ink-soft">
                      {new Date(a.start_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </p>
                  </td>
                  <td className="col-md">
                    <p className="font-semibold text-ink">{a.doctor_name}</p>
                    <p className="text-xs text-ink-soft">{a.doctor_specialty}</p>
                  </td>
                  <td className="col-2xl max-w-[220px] text-ink-soft">
                    <p className="truncate">{a.reason || '—'}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {nextAppointments.length === 0 && <EmptyState icon="calendar" text="No upcoming appointments yet" />}
        </Panel>

        {/* Doctors on duty */}
        <Panel
          title="On Duty Today"
          right={
            <Link to="/clinic/doctors" className="clay-btn-ghost btn-sm">
              Doctors <Icon name="chevronRight" className="h-4 w-4" />
            </Link>
          }
        >
          <div className="space-y-2 px-4 pb-4">
            {onDuty.map((d) => (
              <div key={d.id} className="clay-inset flex items-center gap-3 rounded-2xl px-3 py-2">
                <span className="logo-mark h-8 w-8 !rounded-xl text-[11px] font-extrabold text-white">{initials(d.name)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold text-ink">{d.name}</p>
                  <p className="truncate text-[11px] text-ink-soft">
                    {d.specialty} · {hhmmTo12h(d.start_time)}–{hhmmTo12h(d.end_time)}
                  </p>
                </div>
              </div>
            ))}
            {onDuty.length === 0 && <EmptyState icon="stethoscope" text="No doctors scheduled today" />}
          </div>
        </Panel>
      </div>

      {/* Recent callbacks */}
      <Panel
        className="mt-5"
        title="Recent Callbacks"
        right={
          <Link to="/clinic/calls" className="clay-btn-ghost btn-sm">
            Logs <Icon name="chevronRight" className="h-4 w-4" />
          </Link>
        }
      >
        <div className="grid grid-cols-1 gap-3 px-4 pb-4 md:grid-cols-3">
          {recentCalls.map((call) => (
            <div key={call.id} className="clay-inset flex items-center justify-between gap-3 rounded-2xl px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-ink">{call.patient_name || call.phone_number}</p>
                <p className="truncate text-xs text-ink-soft">{call.reason || formatUtcDateTime(call.created_at)}</p>
              </div>
              {call.outcome ? (
                <OutcomeBadge outcome={call.outcome} />
              ) : (
                <span className="pill bg-sky-100 capitalize text-sky-700">{call.status.replace(/[-_]/g, ' ')}</span>
              )}
            </div>
          ))}
        </div>
        {recentCalls.length === 0 && <EmptyState icon="phoneCall" text="No callbacks made yet" />}
      </Panel>
    </div>
  )
}
