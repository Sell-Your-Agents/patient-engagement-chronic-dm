import { Link } from '@tanstack/react-router'
import { INTENT_LABELS, LANGUAGE_LABELS } from '../hooks/useCalls'
import type { From } from '../lib/backNav'

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Monday-based weekday index (matches backend `working_days`). */
export function mondayIndex(date: Date) {
  return (date.getDay() + 6) % 7
}

/** YYYY-MM-DD in the browser's local time. */
export function localISODate(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function hhmmTo12h(value: string) {
  const [h, m] = value.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`
}

export function initials(name: string) {
  return name
    .replace(/^Dr\.?\s*/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('')
}

const URGENCY_STYLES: Record<string, string> = {
  emergency: 'bad',
  urgent: 'warn',
  soon: 'warn',
  routine: 'info',
}

export function UrgencyBadge({ urgency }: { urgency: string | null }) {
  if (!urgency) return <span className="text-ink-muted">—</span>
  return <span className={`pill capitalize ${URGENCY_STYLES[urgency] || 'mute'}`}>{urgency}</span>
}

const INTENT_TONE: Record<string, string> = {
  appointment_booking: 'violet',
  appointment_change: 'violet',
  doctor_enquiry: 'info',
  clinic_info: 'info',
  missed_call_callback: 'warn',
  human_assistance: 'warn',
  emergency: 'bad',
  other: 'mute',
}

export function IntentBadge({ intent }: { intent: string | null }) {
  if (!intent) return <span className="text-ink-muted">—</span>
  return <span className={`pill ${INTENT_TONE[intent] || 'mute'}`}>{INTENT_LABELS[intent] || intent.replace(/_/g, ' ')}</span>
}

export function LanguageBadge({ language }: { language: string | null }) {
  if (!language) return <span className="text-ink-muted">—</span>
  return <span className="pill mute">{LANGUAGE_LABELS[language] || language}</span>
}

const BOOKING_LABELS: Record<string, { label: string; cls: string }> = {
  confirmed: { label: 'Confirmed by Staff', cls: 'ok' },
  pending: { label: 'Pending appointment', cls: 'warn' },
  not_applicable: { label: 'No booking', cls: 'mute' },
}

export function BookingBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-ink-muted">—</span>
  const b = BOOKING_LABELS[status] || { label: status, cls: 'mute' }
  return <span className={`pill ${b.cls}`}>{b.label}</span>
}

/** The booking badge of a call; when the call made an appointment, it opens that appointment on the Appointments page. */
export function BookingLink({ status, callId, from = 'calls' }: { status: string | null; callId: number; from?: From }) {
  if (status !== 'pending' && status !== 'confirmed') return <BookingBadge status={status} />
  return (
    <Link
      to="/appointments"
      search={{ call: callId, from }}
      className="booking-link"
      title="Open this appointment on the Appointments page"
      onClick={(e) => e.stopPropagation()}
    >
      <span className={`pill ${BOOKING_LABELS[status]!.cls}`}>
        {BOOKING_LABELS[status]!.label} <span aria-hidden>→</span>
      </span>
    </Link>
  )
}

/** Appointment status in the words staff use ("Pending confirmation" until staff confirm it). */
export function AppointmentStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: 'Pending confirmation', cls: 'warn' },
    confirmed: { label: 'Confirmed by Staff', cls: 'ok' },
    cancel_requested: { label: 'Wants to cancel', cls: 'bad' },
    completed: { label: 'Completed', cls: 'info' },
    cancelled: { label: 'Cancelled', cls: 'mute' },
  }
  const m = map[status] || { label: status, cls: 'mute' }
  return <span className={`pill dotted ${m.cls}`}>{m.label}</span>
}

const NOTE_LABELS: [RegExp, string, string][] = [
  [/^APPOINTMENT_RECORDED/, 'Appointment request recorded', 'violet'],
  [/^APPOINTMENT_MOVED/, 'Appointment rescheduled', 'violet'],
  [/^CANCEL_REQUESTED/, 'Cancellation request sent to staff', 'warn'],
  [/^RESCHEDULE_NOT_SAVED/, 'Appointment not rescheduled', 'bad'],
  [/^APPOINTMENT_NOT_FOUND/, 'No appointment found for this number', 'mute'],
  [/^CALLBACK_RECORDED/, 'Callback recorded', 'warn'],
  [/^QUESTION_RECORDED/, 'Question passed to the clinic team', 'info'],
  [/^TRANSFERRING/, 'Transferring to the front desk', 'violet'],
  [/^TRANSFER_FAILED/, 'Transfer failed', 'bad'],
  [/^SYSTEM_ERROR/, 'Could not save', 'bad'],
]

function noteLabel(note: string): [string, string] {
  for (const [re, label, cls] of NOTE_LABELS) if (re.test(note)) return [label + note.replace(/^[A-Z_]+/, '').replace(/^:\s*/, ': ').replace(/^\s+#/, ' #'), cls]
  return [note, 'mute']
}

/** Renders "ASSISTANT: ..." / "USER: ..." transcript lines as chat bubbles. */
export function TranscriptView({ transcript, agentName }: { transcript: string; agentName: string }) {
  const turns = transcript
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(ASSISTANT|USER):\s*(.*)$/)
      const role = match?.[1] === 'USER' ? 'u' : 'a'
      const raw = match ? match[2]! : line
      const notes = Array.from(raw.matchAll(/\[\[(.*?)\]\]/g)).map((m) => m[1]!)
      const text = raw.replace(/\[\[.*?\]\]/g, '').trim()
      return { role, text, notes }
    })

  return (
    <div className="chat">
      {turns.map((turn, i) => (
        <div key={i} className="contents">
          <small className={turn.role === 'u' ? 'r' : ''}>{turn.role === 'u' ? 'Caller' : agentName}</small>
          {turn.text && <div className={`msg ${turn.role}`}>{turn.text}</div>}
          {turn.notes.map((note) => {
            const [label, cls] = noteLabel(note)
            return (
              <span key={note} className={`pill ${cls} ${turn.role === 'u' ? 'self-end' : 'self-start'}`}>
                {label}
              </span>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** Which Appointments list an appointment belongs to. Used by the Appointments chips and the doctor cards, so counts match. */
export type AppointmentList = 'pending' | 'cancel' | 'upcoming' | 'past' | 'cancelled'
export function appointmentList(a: { status: string; start_at: string | null }, today = localISODate(new Date())): AppointmentList {
  if (a.status === 'pending') return 'pending'
  if (a.status === 'cancel_requested') return 'cancel'
  if (a.status === 'cancelled') return 'cancelled'
  if (a.status === 'completed') return 'past'
  // Confirmed: upcoming until its day has passed (then it waits in Past to be marked Visited)
  return a.start_at && a.start_at.slice(0, 10) < today ? 'past' : 'upcoming'
}

/** "Showing only: Anita Grewal  ✕ Clear" above a list filtered to one patient. */
export function PatientFilterChip({ name, onClear }: { name: string; onClear: () => void }) {
  return (
    <span className="patient-filter">
      <span className="text-ink-muted">Showing only</span>
      <b>{name}</b>
      <button type="button" onClick={onClear} title="Show everyone again">
        ✕ Clear
      </button>
    </span>
  )
}

/** "10 AM – 2 PM" from a doctor's working hours. */
export function hoursLabel(start: string, end: string) {
  return `${hhmmTo12h(start).replace(':00', '')} – ${hhmmTo12h(end).replace(':00', '')}`
}
