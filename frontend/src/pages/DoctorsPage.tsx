import { useState } from 'react'
import { useDoctors, useDoctorAvailability, type Doctor } from '../hooks/useClinic'
import { useAppointments } from '../hooks/useAppointments'
import { PageHeader, EmptyState, Loader, ErrorState } from '../components/ui'
import { hhmmTo12h, initials, localISODate, mondayIndex } from '../components/clinic'

export function DoctorsPage() {
  const { data: doctors, isLoading, error } = useDoctors()
  const { data: upcoming } = useAppointments({ date_from: localISODate(new Date()), status: 'booked' })

  if (isLoading) return <Loader text="Loading doctors..." />
  if (error) return <ErrorState text="Error loading doctors" />

  const bookedCount = (doctorId: number) => (upcoming || []).filter((a) => a.doctor_id === doctorId).length

  return (
    <div className="flex flex-col gap-4">
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

function DoctorCard({ doctor, upcoming: _upcoming }: { doctor: Doctor; upcoming: number }) {
  const [showSlots, setShowSlots] = useState(false)
  const { data: slots } = useDoctorAvailability(doctor.id, 7)
  const todayIdx = mondayIndex(new Date())
  const worksToday = doctor.working_days.includes(todayIdx)
  const nextSlot = slots?.[0]

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
    <div className="m-card flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="m-av !h-11 !w-11 text-sm font-extrabold">{initials(doctor.name)}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-extrabold text-[#14212e]">{doctor.name}</div>
          <div className="text-[13px] font-bold text-[#0b6f6a]">{doctor.specialty}</div>
        </div>
        <span className={`m-pill ${worksToday ? 'm-pill-ok' : 'm-pill-mute'}`}>
          {worksToday ? 'On duty' : 'Off today'}
        </span>
      </div>

      <div className="text-xs text-[#56646f] line-clamp-2" title={doctor.treats}>
        Treats: {doctor.treats}
      </div>

      {/* Grid: Days, Hours, Slot */}
      <div className="grid grid-cols-3 gap-2 rounded-lg bg-[#f4f7f9] p-2.5 text-center">
        <div>
          <div className="m-lbl !text-[10px]">Days</div>
          <div className="mt-0.5 text-xs font-bold text-[#14212e]">
            {doctor.working_days.length === 6 ? 'Mon – Sat' : `${doctor.working_days.length} days/wk`}
          </div>
        </div>
        <div>
          <div className="m-lbl !text-[10px]">Hours</div>
          <div className="mt-0.5 whitespace-nowrap text-[11px] font-bold text-[#14212e]">
            {hhmmTo12h(doctor.start_time)}–{hhmmTo12h(doctor.end_time)}
          </div>
        </div>
        <div>
          <div className="m-lbl !text-[10px]">Slot</div>
          <div className="mt-0.5 text-xs font-bold text-[#14212e]">{doctor.slot_minutes} min</div>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs pt-1">
        <span className="text-[#56646f]">
          Next free:{' '}
          <b className="text-[#14212e]">
            {nextSlot
              ? new Date(nextSlot).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })
              : slots
                ? 'None this week'
                : '…'}
          </b>
        </span>
        <button
          onClick={() => setShowSlots((s) => !s)}
          className="m-btn !min-h-[28px] !py-0.5 !px-2.5 !text-xs"
        >
          {showSlots ? 'Hide slots' : `${slots?.length ?? 0} free`}
        </button>
      </div>

      {showSlots && (
        <div className="mt-2 max-h-48 space-y-2 overflow-y-auto rounded-lg border border-[#dbe3ea] bg-[#fafbfc] p-2.5 text-xs">
          {byDay.map((group) => (
            <div key={group.day}>
              <div className="m-lbl !text-[10px] mb-1">{group.day}</div>
              <div className="flex flex-wrap gap-1">
                {group.times.map((t) => (
                  <span key={t} className="rounded bg-white border border-[#cdd7df] px-1.5 py-0.5 text-[11px] font-bold text-[#0b6f6a]">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {byDay.length === 0 && <p className="text-xs text-[#56646f]">No free slots in the next 7 days.</p>}
        </div>
      )}
    </div>
  )
}
