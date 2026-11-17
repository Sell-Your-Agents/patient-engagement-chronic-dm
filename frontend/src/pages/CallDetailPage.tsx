import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { useCall, callerName, INTENT_LABELS, LANGUAGE_LABELS, type CallDetail, type CallTurn } from '../hooks/useCalls'
import { useClinicInfo } from '../hooks/useClinic'
import { PageHeader, Panel, Loader, ErrorState, EmptyState, formatLength, formatUtcDateTime, utcDate } from '../components/ui'
import { IntentBadge, LanguageBadge, BookingBadge } from '../components/clinic'

type Tab = 'transcript' | 'recording'

/** One call on its own page: the call record, summary and what happens next on the left; transcript and recording on the right. */
export function CallDetailPage() {
  const { id } = useParams({ from: '/calls/$id' })
  const { data: call, isLoading, error, refetch } = useCall(Number(id))
  const [tab, setTab] = useState<Tab>('transcript')

  if (isLoading) return <Loader text="Loading call…" variant="detail" />
  if (error || !call) return <ErrorState text="Could not load this call" onRetry={() => refetch()} />

  const live = call.status === 'in-progress'
  const name = callerName(call) || 'Unknown caller'

  return (
    <div className="lg:flex lg:h-[calc(100dvh-70px)] lg:flex-col">
      <PageHeader
        title={`${call.call_ref} · ${name}`}
        back={{ to: '/calls', label: 'Call Records' }}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {live ? (
              <span className="pill ok dotted">Live now</span>
            ) : (
              <span>
                {formatUtcDateTime(call.started_at || call.created_at)} · {formatLength(call.duration_seconds)}
              </span>
            )}
            <span>· {call.channel === 'browser' ? 'browser test call' : 'phone call'}</span>
            <LanguageBadge language={call.language} />
            {!live && <IntentBadge intent={call.intent} />}
            {!live && call.booking_status && call.booking_status !== 'not_applicable' && <BookingBadge status={call.booking_status} />}
          </span>
        }
      />

      {live && (
        <div className="okbox mb-3.5 flex shrink-0 items-center gap-2">
          <span className="dot" /> This call is live. New sentences appear every few seconds; the call record is written when the call ends.
        </div>
      )}

      <div className="grid gap-[14px] lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="grid min-h-0 content-start gap-[14px]">
          <CallRecord call={call} />
          <Panel title="Summary">
            <p className="px-4 pb-4 text-[13.5px] leading-relaxed text-ink-soft">
              {call.summary || (live ? 'Written when the call ends.' : 'No summary for this call.')}
            </p>
          </Panel>
        </div>

        <div className="card flex min-h-0 min-w-0 flex-col">
          <div className="card-h shrink-0">
            <div className="tabs">
              <button className={`tab ${tab === 'transcript' ? 'on' : ''}`} onClick={() => setTab('transcript')}>
                Transcript
              </button>
              <button className={`tab ${tab === 'recording' ? 'on' : ''}`} onClick={() => setTab('recording')}>
                Recording
              </button>
            </div>
            {tab === 'transcript' && <span className="text-[12px] text-ink-muted">{call.turns.length} lines</span>}
          </div>
          {tab === 'transcript' ? <Transcript call={call} /> : <Recording call={call} />}
        </div>
      </div>
    </div>
  )
}

function CallRecord({ call }: { call: CallDetail }) {
  const rows: [string, React.ReactNode][] = [
    ['Caller', callerName(call) || '—'],
    ['Contact', call.phone_number || '—'],
    ['Language', call.language ? LANGUAGE_LABELS[call.language] || call.language : '—'],
    ['Intent', call.intent ? INTENT_LABELS[call.intent] || call.intent : '—'],
    ['Doctor', call.doctor_requested || '—'],
    ['Preferred slot', call.preferred_slot || '—'],
    ['Call outcome', call.outcome || '—'],
    ['Booking status', <BookingBadge key="b" status={call.booking_status} />],
    ['Next action', call.next_action || '—'],
    [
      'Patient',
      call.patient_id ? (
        <Link key="p" to="/patients/$id" params={{ id: String(call.patient_id) }} className="text-brand hover:underline">
          Open patient →
        </Link>
      ) : (
        'Not saved yet'
      ),
    ],
  ]
  if (call.patient_saved_name && call.patient_name && call.patient_name !== call.patient_saved_name) {
    rows.splice(1, 0, ['Name said on this call', call.patient_name])
  }
  return (
    <Panel title="Call record">
      <div className="mx-4 mb-4 grid grid-cols-2 gap-x-4 gap-y-3 rounded-[10px] border border-line-soft bg-card-2 p-3 xl:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <span className="lbl !text-[10px]">{label}</span>
            <b className="block text-[13px] leading-snug break-words">{value}</b>
          </div>
        ))}
      </div>
    </Panel>
  )
}

/** "0:42" from the start of the call */
function offset(turn: CallTurn, start: string | null) {
  if (!start) return ''
  const secs = Math.max(0, Math.round((utcDate(turn.timestamp).getTime() - utcDate(start).getTime()) / 1000))
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
}

const NOTE_TEXT: [RegExp, string][] = [
  [/^APPOINTMENT_RECORDED/, 'Appointment request recorded'],
  [/^CALLBACK_RECORDED/, 'Callback recorded'],
  [/^QUESTION_RECORDED/, 'Question passed to the clinic team'],
  [/^TRANSFERRING/, 'Transferring to the front desk'],
  [/^TRANSFER_FAILED/, 'Transfer failed'],
  [/^SYSTEM_ERROR/, 'Could not save a step'],
]

function Transcript({ call }: { call: CallDetail }) {
  const { data: info } = useClinicInfo()
  const agent = info?.agent_name || 'Agent'
  const who = callerName(call)?.split(' ')[0] || 'Caller'
  const start = call.started_at || call.created_at
  const box = useRef<HTMLDivElement>(null)
  const live = call.status === 'in-progress'

  // While the call is live, keep the newest line in view
  useEffect(() => {
    if (live && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [live, call.turns.length])

  if (call.turns.length === 0) {
    return <EmptyState icon="messages" text={call.status === 'in-progress' ? 'Waiting for the first words…' : 'Nothing was said on this call.'} />
  }

  return (
    <div ref={box} className="chat max-h-[70vh] min-h-0 flex-1 overflow-y-auto px-4 pb-4 lg:max-h-none">
      {call.turns.map((t, i) => {
        const caller = t.role === 'user'
        const notes = Array.from(t.content.matchAll(/\[\[(.*?)\]\]/g)).map((m) => m[1]!)
        const cut = t.content.includes('(cut off:')
        const text = t.content.replace(/\[\[.*?\]\]/g, '').replace(/\s*…?\(cut off:[^)]*\)/, '').trim()
        return (
          <div key={i} className="contents">
            {text && (
              <>
                <small className={caller ? 'r' : ''}>
                  {caller ? who : agent} · {offset(t, start)}
                </small>
                <div className={`msg ${caller ? 'u' : 'a'}`}>
                  {text}
                  {cut && <span className="ml-1 text-[11px] italic opacity-70">(interrupted by the caller)</span>}
                </div>
              </>
            )}
            {notes.map((n) => {
              const label = NOTE_TEXT.find(([re]) => re.test(n))?.[1]
              return label ? (
                <span key={n} className="pill violet self-center">
                  ✓ {label}
                  {n.match(/#\d+/)?.[0] ? ` ${n.match(/#\d+/)![0]}` : ''}
                </span>
              ) : null
            })}
          </div>
        )
      })}
      {call.status === 'in-progress' && <small className="self-center">● live</small>}
    </div>
  )
}

function Recording({ call }: { call: CallDetail }) {
  if (call.recording_url) {
    return (
      <div className="grid gap-3 px-4 pb-4">
        <audio controls src={call.recording_url} className="w-full" />
        <a href={call.recording_url} target="_blank" rel="noreferrer" className="text-[12.5px] font-bold text-brand">
          Open the recording in a new tab
        </a>
      </div>
    )
  }
  return (
    <div className="px-4 pb-4">
      <div className="note text-[13px]">
        No recording for this call. Recording is off, or this was a browser test call. Saving recordings here (and recording the part with the
        receptionist after a transfer) is the next planned step.
      </div>
    </div>
  )
}
