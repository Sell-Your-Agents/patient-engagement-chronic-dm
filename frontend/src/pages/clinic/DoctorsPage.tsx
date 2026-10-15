import { useState } from 'react'
import { useDoctors, useDoctorAvailability, useClinicAppointments, type Doctor } from '../../hooks/useClinic'
import { Icon } from '../../components/Icon'
import { PageHeader, EmptyState, Loader, ErrorState } from '../../components/ui'
import { WEEKDAYS, hhmmTo12h, initials, localISODate, mondayIndex } from '../../components/clinic'

export function DoctorsPage() {
  const { data: doctors, isLoading, error } = useDoctors()
  const { data: upcoming } = useClinicAppointments({ date_from: localISODate(new Date()), status: 'booked' })

  if (isLoading) return <Loader text="Loading doctors..." />
  if (error) return <ErrorState text="Error loading doctors" />

  const bookedCount = (doctorId: number) => (upcoming || []).filter((a) => a.doctor_id === doctorId).length

  return (
    <div>
      <PageHeader
        title="Doctors"
        subtitle="Clinic doctors, their working hours and open slots the agent can book."
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {doctors?.map((d) => <DoctorCard key={d.id} doctor={d} upcoming={bookedCount(d.id)} />)}
      </div>
      {doctors?.length === 0 && <EmptyState icon="stethoscope" text="No doctors configured" />}
    </div>
  )
}

function DoctorCard({ doctor, upcoming }: { doctor: Doctor; upcoming: number }) {
  const [showSlots, setShowSlots] = useState(false)
  const { data: slots } = useDoctorAvailability(doctor.id, 7)
  const todayIdx = mondayIndex(new Date())
  const worksToday = doctor.working_days.includes(todayIdx)
  const nextSlot = slots?.[0]

  // Group free slots by day for the expanded view
  const byDay: { day: string; times: string[] }[] = []
  for (const s of slots || []) {
    const d = new Date(s)
    const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    const last = byDay[byDay.length - 1]
    if (last && last.day === day) last.times.push(time)
    else byDay.push({ day, times: [time] })
  }

  return (
    <div className="clay flex flex-col p-4">
      <div className="flex items-start gap-3">
        <span className="logo-mark h-10 w-10 !rounded-xl text-xs font-extrabold text-white">{initials(doctor.name)}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-extrabold text-ink">{doctor.name}</p>
          <p className="text-[13px] font-semibold text-orange-600">{doctor.specialty}</p>
        </div>
        <span className={`pill ${worksToday ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
          {worksToday ? 'On duty' : 'Off today'}
        </span>
      </div>

      <p className="mt-2.5 truncate text-xs text-ink-soft" title={doctor.treats}>Treats: {doctor.treats}</p>

      {/* Working days */}
      <div className="mt-3 flex gap-1">
        {WEEKDAYS.map((label, i) => {
          const works = doctor.working_days.includes(i)
          return (
            <span
              key={label}
              className={`flex h-7 flex-1 items-center justify-center rounded-lg text-[10.5px] font-bold ${
                works ? 'bg-orange-100 text-orange-700' : 'clay-inset text-ink-muted'
              } ${i === todayIdx ? 'ring-2 ring-orange-400' : ''}`}
            >
              {label}
            </span>
          )
        })}
      </div>

      <div className="clay-inset mt-3 grid grid-cols-3 gap-2 rounded-2xl p-2.5 text-center">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">Timing</p>
          <p className="mt-0.5 whitespace-nowrap text-[11px] font-bold text-ink">
            {hhmmTo12h(doctor.start_time)}–{hhmmTo12h(doctor.end_time)}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">Slot</p>
          <p className="mt-0.5 text-xs font-bold text-ink">{doctor.slot_minutes} min</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">Upcoming</p>
          <p className="mt-0.5 text-xs font-bold text-ink">{upcoming} booked</p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-xs text-ink-soft">
          Next free:{' '}
          <b className="text-ink">
            {nextSlot
              ? new Date(nextSlot).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })
              : slots
                ? 'None this week'
                : '…'}
          </b>
        </p>
        <button onClick={() => setShowSlots((s) => !s)} className="clay-btn-ghost btn-sm">
          {showSlots ? 'Hide slots' : `Free slots (${slots?.length ?? 0})`}
          <Icon name="chevronDown" className={`h-3.5 w-3.5 transition ${showSlots ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {showSlots && (
        <div className="clay-scroll mt-3 max-h-56 space-y-3 overflow-y-auto pr-1">
          {byDay.map((group) => (
            <div key={group.day}>
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-muted">{group.day}</p>
              <div className="flex flex-wrap gap-1.5">
                {group.times.map((t) => (
                  <span key={t} className="rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {byDay.length === 0 && <p className="text-xs text-ink-muted">No free slots in the next 7 days.</p>}
        </div>
      )}
    </div>
  )
}
