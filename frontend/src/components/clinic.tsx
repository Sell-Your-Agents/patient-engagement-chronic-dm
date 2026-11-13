import type { Appointment } from '../hooks/useAppointments'
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

const OUTCOME_LABELS: Record<string, { label: string; cls: string }> = {
  booked: { label: 'Booked', cls: 'ok' },
  appointment_requested: { label: 'Visit requested', cls: 'violet' },
  check_in_completed: { label: 'Check-in done', cls: 'ok' },
  check_in_partial: { label: 'Check-in partly done', cls: 'warn' },
  not_reached: { label: 'Not reached', cls: 'warn' },
  language_support_needed: { label: 'Needs other language', cls: 'violet' },
  completed: { label: 'Completed', cls: 'ok' },
  declined: { label: 'Declined', cls: 'mute' },
  info_only: { label: 'Info only', cls: 'info' },
  call_later: { label: 'Call later', cls: 'warn' },
  wrong_number: { label: 'Wrong number', cls: 'bad' },
  no_conversation: { label: 'No conversation', cls: 'mute' },
}

export function OutcomeBadge({ outcome }: { outcome: string | null }) {
  if (!outcome) return <span className="text-ink-muted">—</span>
  const o = OUTCOME_LABELS[outcome] || { label: outcome, cls: 'mute' }
  return <span className={`pill ${o.cls}`}>{o.label}</span>
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
          {turn.notes.map((note) => (
            <span key={note} className={`pill ${note.startsWith('BOOKED') ? 'ok' : 'warn'} ${turn.role === 'u' ? 'self-end' : 'self-start'}`}>
              {note.startsWith('BOOKED') ? note.replace('BOOKED', 'Booked') : note.replace('BOOKING_FAILED:', 'Booking failed:')}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/** Opens a printable appointment slip in a new window. */
export function printAppointmentSlip(a: Appointment) {
  const win = window.open('', '_blank', 'width=720,height=820')
  if (!win) return
  const row = (label: string, value: string) =>
    `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Appointment ${a.id}</title>
<style>
  body{font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#1e2633;margin:40px}
  .head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #ff7a1a;padding-bottom:14px}
  h1{margin:0;font-size:24px} .sub{color:#5b6576;font-size:13px;margin-top:4px}
  .badge{background:#fff1e6;color:#c2410c;font-weight:700;font-size:12px;padding:6px 12px;border-radius:999px}
  table{width:100%;border-collapse:collapse;margin-top:24px} th,td{text-align:left;padding:12px 8px;border-bottom:1px solid #e2e8f0;font-size:14px;vertical-align:top}
  th{width:34%;color:#5b6576;font-weight:600} td{font-weight:700}
  .foot{margin-top:28px;color:#5b6576;font-size:12px;line-height:1.6}
</style></head><body>
<div class="head"><div><h1>${escapeHtml(a.clinic_name)}</h1><div class="sub">Appointment Confirmation</div></div>
<span class="badge">${a.id} · ${escapeHtml(a.status.toUpperCase())}</span></div>
<table>
${row('Patient Name', a.patient_name)}
${row('Phone', a.phone_number || '—')}
${row('Date & Time', `${formatDateTime(a.start_at)} – ${formatTime(a.end_at)}`)}
${row('Doctor', `${a.doctor_name} (${a.doctor_specialty})`)}
${row('Reason for Visit', a.reason || '—')}
${row('Clinic', a.clinic_name)}
${row('Booked Via', a.source === 'agent' ? 'AI phone agent' : 'Clinic staff')}
</table>
<div class="foot">Please arrive 10 minutes before your appointment time and bring any previous prescriptions or reports.</div>
<script>window.onload=function(){window.print()}</script>
</body></html>`)
  win.document.close()
}
