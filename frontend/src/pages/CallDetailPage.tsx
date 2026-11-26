import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearch } from '@tanstack/react-router'
import { backTarget } from '../lib/backNav'
import { useCall, callerName, INTENT_LABELS, LANGUAGE_LABELS, type CallDetail, type CallTurn } from '../hooks/useCalls'
import { useClinicInfo } from '../hooks/useClinic'
import { PageHeader, Panel, Loader, ErrorState, EmptyState, Spinner, formatLength, formatUtcDateTime, utcDate } from '../components/ui'
import { Icon } from '../components/Icon'
import { apiClient } from '../lib/apiClient'
import { IntentBadge, LanguageBadge, BookingLink } from '../components/clinic'

/** One call on its own page: the call record and summary on the left; the recording and transcript together on the right. */
export function CallDetailPage() {
  const { id } = useParams({ from: '/calls/$id' })
  // Opened from another page (Dashboard, Appointments, Follow-ups, a patient): back goes there; otherwise to the list
  const { from } = useSearch({ from: '/calls/$id' })
  const back = backTarget(from, { to: '/calls', label: 'All call records' })
  const { data: call, isLoading, error, refetch } = useCall(Number(id))

  if (isLoading) return <Loader text="Loading call…" variant="detail" />
  if (error || !call) return <ErrorState text="Could not load this call" onRetry={() => refetch()} />

  const live = call.status === 'in-progress'
  const name = callerName(call) || 'Unknown caller'

  return (
    <div className="lg:flex lg:h-[calc(100dvh-70px)] lg:flex-col">
      <PageHeader
        title={`${call.call_ref} · ${name}`}
        back={back}
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
            {!live && call.booking_status && call.booking_status !== 'not_applicable' && <BookingLink status={call.booking_status} callId={call.id} from={`call-${call.id}`} />}
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

        <ListenAndRead call={call} />
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
    ['Booking status', <BookingLink key="b" status={call.booking_status} callId={call.id} from={`call-${call.id}`} />],
    ['Next action', call.next_action || '—'],
    [
      'Patient',
      call.patient_id ? (
        <Link key="p" to="/patients/$id" params={{ id: String(call.patient_id) }} search={{ from: `call-${call.id}` }} className="text-brand hover:underline">
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

/** Seconds from the start of the call to this line */
function turnSeconds(turn: CallTurn, start: string | null) {
  if (!start) return 0
  return Math.max(0, (utcDate(turn.timestamp).getTime() - utcDate(start).getTime()) / 1000)
}

/** "0:42" */
function clock(secs: number) {
  const s = Math.max(0, Math.floor(secs))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const NOTE_TEXT: [RegExp, string][] = [
  [/^APPOINTMENT_RECORDED/, 'Appointment request recorded'],
  [/^CALLBACK_RECORDED/, 'Callback recorded'],
  [/^QUESTION_RECORDED/, 'Question passed to the clinic team'],
  [/^TRANSFERRING/, 'Transferring to the front desk'],
  [/^TRANSFER_FAILED/, 'Transfer failed'],
  [/^SYSTEM_ERROR/, 'Could not save a step'],
]

const SPEEDS = [0.75, 1, 1.25, 1.5, 2]
const BARS = 160

/** Loudness of the recording in BARS slices (0..1), for the waveform. */
async function wavePeaks(blob: Blob): Promise<number[]> {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new Ctx()
  try {
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer())
    const data = audio.getChannelData(0)
    const size = Math.max(1, Math.floor(data.length / BARS))
    const peaks: number[] = []
    for (let b = 0; b < BARS; b++) {
      let sum = 0
      const from = b * size
      const to = Math.min(data.length, from + size)
      for (let i = from; i < to; i++) sum += data[i]! * data[i]!
      peaks.push(Math.sqrt(sum / Math.max(1, to - from)))
    }
    const max = Math.max(...peaks, 1e-6)
    return peaks.map((p) => p / max)
  } finally {
    ctx.close().catch(() => undefined)
  }
}

/** The recording as bars: the played part is coloured; click or drag anywhere to jump there. */
function Waveform({ peaks, progress, onSeek }: { peaks: number[] | null; progress: number; onSeek: (fraction: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const dragging = useRef(false)
  const bars = peaks || Array.from({ length: BARS }, (_, i) => 0.25 + 0.2 * Math.abs(Math.sin(i / 5)))
  const fractionAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width))
  }
  const played = Math.round(progress * bars.length)
  const hovered = hover === null ? -1 : Math.round(hover * bars.length)
  return (
    <div
      ref={ref}
      className={`wave ${peaks ? '' : 'loading'}`}
      role="slider"
      tabIndex={0}
      aria-label="Play position"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      onPointerDown={(e) => {
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        onSeek(fractionAt(e.clientX))
      }}
      onPointerMove={(e) => {
        setHover(fractionAt(e.clientX))
        if (dragging.current) onSeek(fractionAt(e.clientX))
      }}
      onPointerUp={() => (dragging.current = false)}
      onPointerLeave={() => setHover(null)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') onSeek(Math.min(1, progress + 0.02))
        if (e.key === 'ArrowLeft') onSeek(Math.max(0, progress - 0.02))
      }}
    >
      {bars.map((h, i) => (
        <i key={i} className={`${i < played ? 'on' : ''} ${i >= played && i < hovered ? 'hover' : ''}`} style={{ height: `${Math.max(8, h * 100)}%` }} />
      ))}
      <span className="wave-cursor" style={{ left: `${progress * 100}%` }} />
    </div>
  )
}

/**
 * The recording and the transcript in one panel: the waveform player on top, the conversation below.
 * While it plays, the transcript scrolls by itself to keep the line being spoken in the middle (like
 * song lyrics). Scroll by hand and it stops following until "Back to the current line" is pressed.
 * The recording is fetched with the staff login (never a public link).
 */
function ListenAndRead({ call }: { call: CallDetail }) {
  const { data: info } = useClinicInfo()
  const agent = info?.agent_name || 'Agent'
  const who = callerName(call)?.split(' ')[0] || 'Caller'
  const start = call.started_at || call.created_at
  const live = call.status === 'in-progress'
  const box = useRef<HTMLDivElement>(null)
  const audio = useRef<HTMLAudioElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [peaks, setPeaks] = useState<number[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [now, setNow] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [length, setLength] = useState(0)
  // True after the user scrolls the transcript by hand while it plays: stop following the audio
  const [detached, setDetached] = useState(false)
  const autoScrolling = useRef(false)

  useEffect(() => {
    if (!call.recording_url) return
    let cancelled = false
    let objectUrl: string | null = null
    setFailed(false)
    setPeaks(null)
    apiClient
      .callRecording(call.id)
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
        wavePeaks(blob)
          .then((p) => !cancelled && setPeaks(p))
          .catch(() => !cancelled && setPeaks(Array.from({ length: BARS }, () => 0.3)))
      })
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [call.id, call.recording_url])

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = speed
  }, [speed, url])

  // While the call is live, keep the newest line in view
  useEffect(() => {
    if (live && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [live, call.turns.length])

  const lines = call.turns.map((t) => ({ t, secs: turnSeconds(t, start) }))
  // The line being played: the last one that started at or before the play position
  const current = url && (playing || now > 0) ? lines.reduce((found, l, i) => (l.secs <= now + 0.6 ? i : found), -1) : -1

  // Follow the audio: keep the current line in the middle of the transcript
  useEffect(() => {
    const el = box.current
    if (!el || current < 0 || detached) return
    const line = el.querySelector<HTMLElement>(`[data-line="${current}"]`)
    if (!line) return
    autoScrolling.current = true
    el.scrollTo({ top: line.offsetTop - el.clientHeight / 2 + line.offsetHeight / 2, behavior: 'smooth' })
    const t = window.setTimeout(() => (autoScrolling.current = false), 700)
    return () => window.clearTimeout(t)
  }, [current, detached])

  const userScrolled = () => {
    if (playing && !autoScrolling.current) setDetached(true)
  }

  const seekTo = (secs: number, play = true) => {
    const a = audio.current
    if (!a) return
    a.currentTime = Math.max(0, Math.min(length || secs, secs))
    setNow(a.currentTime)
    setDetached(false)
    if (play) void a.play()
  }

  return (
    <div className="card flex min-h-0 min-w-0 flex-col">
      <div className="card-h shrink-0">
        <b className="text-[15px]">{call.recording_url ? 'Recording & transcript' : 'Transcript'}</b>
        {url && (
          <a href={url} download={`${call.call_ref}.wav`} className="btn sm">
            Download
          </a>
        )}
      </div>

      {call.recording_url && (
        <div className="mx-4 mb-2 shrink-0 rounded-[12px] border border-line bg-card-2 p-3">
          {failed ? (
            <p className="text-[13px] text-bad">Could not load the recording. It may have been deleted from the server.</p>
          ) : !url ? (
            <p className="flex items-center gap-2 text-[13px] text-ink-muted">
              <Spinner /> Loading the recording…
            </p>
          ) : (
            <>
              <audio
                ref={audio}
                src={url}
                preload="metadata"
                onLoadedMetadata={(e) => {
                  e.currentTarget.playbackRate = speed
                  setLength(e.currentTarget.duration || 0)
                }}
                onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
              />
              <Waveform peaks={peaks} progress={length ? Math.min(1, now / length) : 0} onSeek={(f) => seekTo(f * length, playing)} />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  className="player-play"
                  onClick={() => (playing ? audio.current?.pause() : void audio.current?.play())}
                  aria-label={playing ? 'Pause' : 'Play'}
                >
                  <Icon name={playing ? 'pause' : 'play'} className="h-4 w-4" />
                </button>
                <b className="text-[14px] tabular-nums">
                  {clock(now)} <span className="font-normal text-ink-muted">/ {clock(length)}</span>
                </b>
                <span className="ml-auto text-[12.5px] text-ink-muted">Speed</span>
                <div className="tabs">
                  {SPEEDS.map((s) => (
                    <button key={s} className={`tab ${speed === s ? 'on' : ''}`} onClick={() => setSpeed(s)}>
                      {s}×
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-1 pt-2">
        <span className="lbl">Transcript · {call.turns.length} lines</span>
        {url &&
          (detached && playing ? (
            <button className="btn sm p" onClick={() => setDetached(false)}>
              ↓ Back to the current line
            </button>
          ) : (
            <small className="text-ink-muted">The transcript follows the recording. Click a line to play from there.</small>
          ))}
      </div>

      {call.turns.length === 0 ? (
        <EmptyState icon="messages" text={live ? 'Waiting for the first words…' : 'Nothing was said on this call.'} />
      ) : (
        <div
          ref={box}
          className={`lyrics relative max-h-[70vh] min-h-0 flex-1 overflow-y-auto px-2 pb-3 lg:max-h-none ${playing ? 'playing' : ''}`}
          onWheel={userScrolled}
          onTouchMove={userScrolled}
        >
          {lines.map(({ t, secs }, i) => {
            const caller = t.role === 'user'
            const notes = Array.from(t.content.matchAll(/\[\[(.*?)\]\]/g)).map((m) => m[1]!)
            const cut = t.content.includes('(cut off:')
            const text = t.content.replace(/\[\[.*?\]\]/g, '').replace(/\s*…?\(cut off:[^)]*\)/, '').trim()
            return (
              <div key={i}>
                {text && (
                  <div
                    data-line={i}
                    className={`tline ${caller ? 'pt' : ''} ${i === current ? 'now' : ''} ${url ? 'cursor-pointer' : ''}`}
                    onClick={url ? () => seekTo(secs - 0.2) : undefined}
                    title={url ? 'Play from here' : undefined}
                  >
                    <span className="ts">{clock(secs)}</span>
                    <span className="who">{caller ? who : agent}</span>
                    <span>
                      {text}
                      {cut && <span className="ml-1 text-[11px] italic text-ink-muted">(interrupted by the caller)</span>}
                    </span>
                  </div>
                )}
                {notes.map((n) => {
                  const label = NOTE_TEXT.find(([re]) => re.test(n))?.[1]
                  return label ? (
                    <div key={n} className="py-1 pl-[124px]">
                      <span className="pill violet">
                        ✓ {label}
                        {n.match(/#\d+/)?.[0] ? ` ${n.match(/#\d+/)![0]}` : ''}
                      </span>
                    </div>
                  ) : null
                })}
              </div>
            )
          })}
          {live && <small className="block px-2 text-ink-muted">● live</small>}
        </div>
      )}

      {call.recording_url && (
        <p className="mx-4 mb-3 shrink-0 border-t border-line-soft pt-2 text-[12px] text-ink-muted">
          The caller heard the recording notice at the start of the call. Only signed-in clinic staff can play or download recordings.
        </p>
      )}
    </div>
  )
}
