import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useDoctors, useDoctorAvailability, useSaveDoctor, type Doctor, type DoctorInput } from '../hooks/useClinic'
import { useAppointments } from '../hooks/useAppointments'
import { PageHeader, EmptyState, Loader, ErrorState, Avatar, Modal, Spinner, friendlyTime } from '../components/ui'
import { WEEKDAYS, hhmmTo12h, localISODate, mondayIndex } from '../components/clinic'
import { toast, errorText } from '../components/toast'
import { Icon } from '../components/Icon'

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
  const [editing, setEditing] = useState<Doctor | 'new' | null>(null)

  if (isLoading) return <Loader text="Loading doctors…" variant="cards" />
  if (error) return <ErrorState text="Could not load doctors" onRetry={() => refetch()} />

  const today = mondayIndex(new Date())
  const onDuty = (d: Doctor) => d.is_active && d.working_days.includes(today)
  const all = doctors || []
  const list = all.filter((d) => (filter === 'all' ? true : filter === 'on' ? onDuty(d) : !onDuty(d)))
  const booked = (id: number) => (upcoming || []).filter((a) => a.doctor_id === id && (a.status === 'pending' || a.status === 'confirmed')).length

  return (
    <div>
      <PageHeader
        title="Doctors"
        subtitle={`${all.filter(onDuty).length} on duty today · ${all.length} doctors · the agent only tells callers what is saved here`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
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
          <button className="btn p" onClick={() => setEditing('new')}>
            <Icon name="plus" className="h-4 w-4" /> Add doctor
          </button>
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
            <DoctorCard key={d.id} doctor={d} duty={onDuty(d)} today={today} booked={booked(d.id)} onEdit={() => setEditing(d)} />
          ))}
        </div>
      )}
      {editing && <DoctorModal doctor={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function DoctorCard({ doctor, duty, today, booked, onEdit }: { doctor: Doctor; duty: boolean; today: number; booked: number; onEdit: () => void }) {
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
          <small>
            {doctor.specialty}
            {doctor.qualification ? ` · ${doctor.qualification}` : ''}
          </small>
        </div>
        <span className={`pill ${doctor.is_active && duty ? 'ok dotted' : 'mute'}`}>{!doctor.is_active ? 'Inactive' : duty ? 'On duty' : 'Off today'}</span>
      </div>
      <p className="text-[13.5px] text-ink-soft">Treats: {doctor.treats || '—'}</p>
      <p className="text-[12.5px] text-ink-muted">
        Fee: {doctor.consultation_fee || 'not listed'}
        {doctor.languages ? ` · Speaks ${doctor.languages}` : ''}
      </p>
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
          {slots?.length ?? 0} free this week · {booked} held
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
          Appointments
        </Link>
        <button className="btn sm" onClick={onEdit}>
          <Icon name="edit" className="h-3.5 w-3.5" /> Edit
        </button>
        <button className="btn sm" onClick={() => setShowAll((s) => !s)} disabled={!slots?.length}>
          {showAll ? 'Less' : 'Week view'}
        </button>
      </div>
    </div>
  )
}

function DoctorModal({ doctor, onClose }: { doctor: Doctor | null; onClose: () => void }) {
  const save = useSaveDoctor()
  const [form, setForm] = useState<DoctorInput>(
    doctor
      ? { ...doctor }
      : {
          name: '',
          specialty: '',
          qualification: '',
          treats: '',
          working_days: [0, 1, 2, 3, 4, 5],
          start_time: '10:00',
          end_time: '13:00',
          slot_minutes: 15,
          consultation_fee: '',
          languages: 'English, Hindi, Telugu',
          is_active: true,
        },
  )
  const [err, setErr] = useState<string | null>(null)
  const set = <K extends keyof DoctorInput>(key: K, value: DoctorInput[K]) => setForm((f) => ({ ...f, [key]: value }))
  const hoursOk = form.start_time < form.end_time
  const valid = form.name.trim().length > 1 && form.specialty.trim().length > 1 && hoursOk && form.working_days.length > 0

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid) return
    setErr(null)
    const data: DoctorInput = {
      ...form,
      name: form.name.trim(),
      specialty: form.specialty.trim(),
      qualification: form.qualification?.trim() || null,
      consultation_fee: form.consultation_fee?.trim() || null,
      languages: form.languages?.trim() || null,
    }
    save.mutate(
      { id: doctor?.id ?? null, data },
      {
        onSuccess: () => {
          toast.success(doctor ? 'Doctor updated' : 'Doctor added', data.name)
          onClose()
        },
        onError: (er) => setErr(errorText(er, 'Could not save the doctor.')),
      },
    )
  }

  return (
    <Modal open onClose={onClose} title={doctor ? 'Edit doctor' : 'Add doctor'} subtitle="The agent tells callers exactly what is saved here">
      <form onSubmit={submit} className="space-y-3.5">
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="lbl mb-1.5 block">Name</span>
            <input className="field" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Dr. Ramesh Agarwal" autoFocus />
          </label>
          <label>
            <span className="lbl mb-1.5 block">Specialty</span>
            <input className="field" value={form.specialty} onChange={(e) => set('specialty', e.target.value)} placeholder="General Physician" />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="lbl mb-1.5 block">Qualification</span>
            <input className="field" value={form.qualification || ''} onChange={(e) => set('qualification', e.target.value)} placeholder="MBBS, MD" />
          </label>
          <label>
            <span className="lbl mb-1.5 block">Consultation fee</span>
            <input className="field" value={form.consultation_fee || ''} onChange={(e) => set('consultation_fee', e.target.value)} placeholder="Empty = not shared" />
          </label>
        </div>
        <label className="block">
          <span className="lbl mb-1.5 block">Treats (helps the agent pick the right doctor)</span>
          <input className="field" value={form.treats} onChange={(e) => set('treats', e.target.value)} placeholder="fever, cough, infections, general check-ups" />
        </label>
        <div>
          <span className="lbl mb-1.5 block">Consultation days</span>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((w, i) => {
              const on = form.working_days.includes(i)
              return (
                <button
                  type="button"
                  key={w}
                  className={`chip ${on ? '!border-brand !bg-brand !text-white' : ''}`}
                  onClick={() => set('working_days', on ? form.working_days.filter((d) => d !== i) : [...form.working_days, i].sort())}
                >
                  {w}
                </button>
              )
            })}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <label>
            <span className="lbl mb-1.5 block">From</span>
            <input type="time" className="field" value={form.start_time} onChange={(e) => set('start_time', e.target.value)} />
          </label>
          <label>
            <span className="lbl mb-1.5 block">To</span>
            <input type="time" className="field" value={form.end_time} onChange={(e) => set('end_time', e.target.value)} />
          </label>
          <label>
            <span className="lbl mb-1.5 block">Slot (min)</span>
            <input type="number" min={5} max={120} className="field" value={form.slot_minutes} onChange={(e) => set('slot_minutes', Number(e.target.value) || 15)} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="lbl mb-1.5 block">Languages spoken</span>
            <input className="field" value={form.languages || ''} onChange={(e) => set('languages', e.target.value)} />
          </label>
          <label className="flex items-end gap-2 pb-2.5">
            <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
            <span className="text-[13.5px] font-bold">Active (the agent offers this doctor)</span>
          </label>
        </div>
        {!hoursOk && <p className="text-[12.5px] text-bad">The end time must be after the start time.</p>}
        {err && <p className="alertbox !text-[13px]">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn p" disabled={!valid || save.isPending}>
            {save.isPending && <Spinner />} {doctor ? 'Save changes' : 'Add doctor'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
