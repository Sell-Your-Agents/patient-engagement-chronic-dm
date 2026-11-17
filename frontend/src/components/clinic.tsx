import type { Appointment } from '../hooks/useAppointments'
import { INTENT_LABELS, LANGUAGE_LABELS } from '../hooks/useCalls'
import { formatDateTime, formatTime } from './ui'

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
  confirmed: { label: 'Confirmed', cls: 'ok' },
  pending: { label: 'Pending confirmation', cls: 'warn' },
  not_applicable: { label: 'No booking', cls: 'mute' },
}

export function BookingBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-ink-muted">—</span>
  const b = BOOKING_LABELS[status] || { label: status, cls: 'mute' }
  return <span className={`pill ${b.cls}`}>{b.label}</span>
}

/** Appointment status, with "pending" spelled out as the document's "Pending confirmation". */
export function AppointmentStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: 'Pending confirmation', cls: 'warn' },
    confirmed: { label: 'Confirmed', cls: 'ok' },
    completed: { label: 'Completed', cls: 'info' },
    cancelled: { label: 'Cancelled', cls: 'mute' },
  }
  const m = map[status] || { label: status, cls: 'mute' }
  return <span className={`pill dotted ${m.cls}`}>{m.label}</span>
}

const NOTE_LABELS: [RegExp, string, string][] = [
  [/^APPOINTMENT_RECORDED/, 'Appointment request recorded', 'violet'],
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

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/** Opens a printable appointment slip in a new window. */
export function printAppointmentSlip(a: Appointment, clinicName: string) {
  const win = window.open('', '_blank', 'width=720,height=820')
  if (!win) return
  const row = (label: string, value: string) =>
    `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Appointment ${a.id}</title>
<style>
  body{font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#1e2633;margin:40px}
  .head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #1d6fd8;padding-bottom:14px}
  h1{margin:0;font-size:24px} .sub{color:#5b6576;font-size:13px;margin-top:4px}
  .badge{background:#e8f1fc;color:#1d4f9c;font-weight:700;font-size:12px;padding:6px 12px;border-radius:999px}
  table{width:100%;border-collapse:collapse;margin-top:24px} th,td{text-align:left;padding:12px 8px;border-bottom:1px solid #e2e8f0;font-size:14px;vertical-align:top}
  th{width:34%;color:#5b6576;font-weight:600} td{font-weight:700}
  .foot{margin-top:28px;color:#5b6576;font-size:12px;line-height:1.6}
</style></head><body>
<div class="head"><div><h1>${escapeHtml(clinicName)}</h1><div class="sub">Appointment Confirmation</div></div>
<span class="badge">${a.id} · ${escapeHtml(a.status.toUpperCase())}</span></div>
<table>
${row('Patient Name', a.patient_name)}
${row('Phone', a.phone_number || '—')}
${row('Date & Time', `${formatDateTime(a.start_at)} – ${formatTime(a.end_at)}`)}
${row('Doctor', `${a.doctor_name}${a.doctor_specialty ? ` (${a.doctor_specialty})` : ''}`)}
${row('Reason for Visit', a.reason || '—')}
${row('Clinic', clinicName)}
${row('Requested via', a.source === 'agent' ? 'AI calling agent' : 'Clinic staff')}
</table>
<div class="foot">Please arrive 10 minutes before your appointment time and bring any previous prescriptions or reports.</div>
<script>window.onload=function(){window.print()}</script>
</body></html>`)
  win.document.close()
}
