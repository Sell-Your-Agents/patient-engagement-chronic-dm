import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useDoctors, useDoctorAvailability, type Doctor } from '../hooks/useClinic'
import { useAppointments } from '../hooks/useAppointments'
import { PageHeader, EmptyState, Loader, ErrorState, Avatar, friendlyTime } from '../components/ui'
import { WEEKDAYS, hhmmTo12h, localISODate, mondayIndex } from '../components/clinic'

type Filter = 'all' | 'on' | 'off'

/** "Mon – Sat" for a contiguous run, otherwise "Mon, Wed, Fri". */
function daysLabel(days: number[]) {
  const s = [...days].sort((a, b) => a - b)
  if (!s.length) return '—'
  const run = s.every((d, i) => i === 0 || d === s[i - 1]! + 1)
  return run && s.length >= 3 ? `${WEEKDAYS[s[0]!]} – ${WEEKDAYS[s[s.length - 1]!]}` : s.map((d) => WEEKDAYS[d]).join(', ')
}

export function DoctorsPage() {
  const { data: doctors, isLoading, error, refetch } = useDoctors()
  const { data: upcoming } = useAppointments({ date_from: localISODate(new Date()) })
  const [filter, setFilter] = useState<Filter>('all')

  if (isLoading) return <Loader text="Loading doctors…" variant="cards" />
  if (error) return <ErrorState text="Could not load doctors" onRetry={() => refetch()} />

  const today = mondayIndex(new Date())
  const onDuty = (d: Doctor) => d.is_active && d.working_days.includes(today)
  const all = doctors || []
  const list = all.filter((d) => (filter === 'all' ? true : filter === 'on' ? onDuty(d) : !onDuty(d)))
  const booked = (id: number) => (upcoming || []).filter((a) => a.doctor_id === id && a.status !== 'cancelled').length

  return (
    <div>
      <PageHeader
        title="Doctors"
        subtitle={`${all.filter(onDuty).length} on duty today · ${all.length} doctors`}
        actions={
          <div className="tabs">
            {(
              [
                ['all', 'All', all.length],
                ['on', 'On duty', all.filter(onDuty).length],
                ['off', 'Off today', all.filter((d) => !onDuty(d)).length],
              ] as const
            ).map(([k, l, n]) => (
              <button key={k} className={`tab ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
                {l} <span className="c">{n}</span>
              </button>
            ))}
          </div>
        }
      />
      {list.length === 0 ? (
        <div className="card">
          <EmptyState icon="stethoscope" text="No doctors here." />
        </div>
      ) : (
        <div className="grid g3">
          {list.map((d) => (
            <DoctorCard key={d.id} doctor={d} duty={onDuty(d)} today={today} booked={booked(d.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function DoctorCard({ doctor, duty, today, booked }: { doctor: Doctor; duty: boolean; today: number; booked: number }) {
  const { data: slots } = useDoctorAvailability(doctor.id, 7)
  const [showAll, setShowAll] = useState(false)
  const next = slots?.[0]
  const todayKey = localISODate(new Date())
  const todaySlots = (slots || []).filter((s) => localISODate(new Date(s)) === todayKey)
  const shown = showAll ? slots || [] : todaySlots.length ? todaySlots : (slots || []).slice(0, 6)
  const label = todaySlots.length && !showAll ? 'Free today' : showAll ? 'Free this week' : 'Next free slots'

  return (
    <div className="card doc">
      <div className="hd">
        <Avatar name={doctor.name} size={46} />
        <div className="min-w-0 flex-1">
          <b className="truncate">{doctor.name}</b>
          <small>{doctor.specialty}</small>
        </div>
        <span className={`pill ${duty ? 'ok dotted' : 'mute'}`}>{duty ? 'On duty' : 'Off today'}</span>
      </div>
      <p className="text-[13.5px] text-ink-soft">Treats: {doctor.treats}</p>
      <div className="spec">
        <div>
          <div className="lbl !text-[10px]">Days</div>
          <b>{daysLabel(doctor.working_days)}</b>
        </div>
        <div>
          <div className="lbl !text-[10px]">Hours</div>
          <b>
            {hhmmTo12h(doctor.start_time).replace(':00', '')} – {hhmmTo12h(doctor.end_time).replace(':00', '')}
          </b>
        </div>
        <div>
          <div className="lbl !text-[10px]">Slot</div>
          <b>{doctor.slot_minutes} min</b>
        </div>
      </div>
      <div className="days">
        {WEEKDAYS.map((w, i) => (
          <i key={w} title={w} className={`${doctor.working_days.includes(i) ? 'on' : ''} ${i === today ? 'today' : ''}`} />
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-3">
        <span className="text-[13px]">
          Next free: <b>{next ? friendlyTime(next) : slots ? 'None this week' : '…'}</b>
        </span>
        <span className="text-[12.5px] text-ink-muted">
          {slots?.length ?? 0} free this week · {booked} booked
        </span>
      </div>
      {slots && slots.length > 0 && (
        <div>
          <div className="lbl mb-2">{label}</div>
          <div className={`slots ${showAll ? 'max-h-40 overflow-y-auto' : ''}`}>
            {shown.map((s) => (
              <span key={s} title={new Date(s).toLocaleString()}>
                {showAll || !todaySlots.length
                  ? new Date(s).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })
                  : new Date(s).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <Link to="/appointments" className="btn sm p flex-1">
          Book slot
        </Link>
        <button className="btn sm" onClick={() => setShowAll((s) => !s)} disabled={!slots?.length}>
          {showAll ? 'Less' : 'Week view'}
        </button>
      </div>
    </div>
  )
}
