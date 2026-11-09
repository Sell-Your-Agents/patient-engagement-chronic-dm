import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Call, Device } from '@twilio/voice-sdk'
import { apiClient } from '../lib/apiClient'
import { DirectCall } from '../lib/directCall'
import { usePatients } from '../hooks/usePatients'
import { apiErrorMessage } from '../hooks/useClinic'
import type { Call as CallLogEntry } from '../hooks/useCalls'
import { Icon } from '../components/Icon'
import { PageHeader, Panel, Loader, ErrorState } from '../components/ui'
import { OutcomeBadge, TranscriptView } from '../components/clinic'

type Phase = 'idle' | 'connecting' | 'live' | 'ended'
/** direct: browser <-> backend, no Twilio. twilio: Twilio Voice SDK through the clinic-number webhook. */
type Mode = 'direct' | 'twilio'

const NEW_CALLER = 'new'
const LOOKUP_ATTEMPTS = 30

function formatSeconds(total: number) {
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function micError(err: unknown, fallback: string) {
  const name = (err as { name?: string })?.name
  if (name === 'NotAllowedError') return 'Microphone access was blocked. Allow the microphone for this site and try again.'
  if (name === 'NotFoundError') return 'No microphone was found. Connect one and try again.'
  return apiErrorMessage(err, fallback)
}

/**
 * Talk to the agent from the browser, as if you were phoning the clinic.
 * Both ways end up in the same agent code as a real call to the clinic number.
 */
export function CallAgentPage() {
  const status = useQuery({ queryKey: ['browser-call', 'status'], queryFn: () => apiClient.browserCallStatus() })
  const { data: patients } = usePatients(0, 100)

  const [mode, setMode] = useState<Mode>('direct')
  const [callAs, setCallAs] = useState<string>(NEW_CALLER)
  const [callerNumber, setCallerNumber] = useState('')
  const [record, setRecord] = useState(false)
  const [recordTouched, setRecordTouched] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [muted, setMuted] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [callSid, setCallSid] = useState<string | null>(null)
  const [callId, setCallId] = useState<number | null>(null)
  const [logEntry, setLogEntry] = useState<CallLogEntry | null>(null)
  const [lookupDone, setLookupDone] = useState(false)
  const deviceRef = useRef<Device | null>(null)
  const twilioCallRef = useRef<Call | null>(null)
  const directRef = useRef<DirectCall | null>(null)

  // Default the record box from the server setting until the user changes it
  useEffect(() => {
    if (status.data && !recordTouched) setRecord(status.data.recording_default)
  }, [status.data, recordTouched])

  // Hang up and release the microphone if the user leaves the page mid-call
  useEffect(
    () => () => {
      directRef.current?.hangUp()
      twilioCallRef.current?.disconnect()
      deviceRef.current?.destroy()
    },
    [],
  )

  useEffect(() => {
    if (phase !== 'live') return
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(timer)
  }, [phase])

  // After the call, find it in the call log and wait for the summary (written when the call is finalized)
  useEffect(() => {
    if (phase !== 'ended' || (!callId && !callSid)) return
    let attempts = 0
    let stopped = false
    const done = () => {
      clearInterval(timer)
      if (!stopped) setLookupDone(true)
    }
    const timer = setInterval(async () => {
      attempts += 1
      try {
        let match: CallLogEntry | null = null
        if (callId) {
          match = (await apiClient.getCall(callId)) as CallLogEntry
        } else {
          const calls = (await apiClient.listCalls({ direction: 'inbound', limit: 25 })) as CallLogEntry[]
          match = calls.find((c) => c.call_sid === callSid) || null
        }
        if (!stopped && match) setLogEntry(match)
        if (match?.summary || attempts >= LOOKUP_ATTEMPTS) done()
      } catch {
        if (attempts >= LOOKUP_ATTEMPTS) done()
      }
    }, 2000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [phase, callId, callSid])

  const resetForCall = () => {
    setError(null)
    setSeconds(0)
    setCallSid(null)
    setCallId(null)
    setLogEntry(null)
    setLookupDone(false)
    setMuted(false)
    setPhase('connecting')
  }

  const patientId = callAs === NEW_CALLER ? null : Number(callAs)

  // ---------- Direct test call (no Twilio) ----------
  const startDirect = async () => {
    resetForCall()
    const token = localStorage.getItem('access_token')
    if (!token) {
      setError('Your login has expired. Log in again and retry.')
      setPhase('idle')
      return
    }
    const call = new DirectCall({
      token,
      patientId,
      callerNumber: callAs === NEW_CALLER ? callerNumber.trim() : '',
      announceRecording: record,
      onConnected: ({ callId: id, callSid: sid }) => {
        setCallId(id)
        setCallSid(sid)
        setPhase('live')
      },
      onEnded: (message) => {
        directRef.current = null
        if (message) setError(message)
        setPhase('ended')
      },
    })
    directRef.current = call
    try {
      await call.start()
    } catch (err) {
      directRef.current = null
      setError(micError(err, 'Could not start the call.'))
      setPhase('idle')
    }
  }

  // ---------- Through Twilio (Voice SDK) ----------
  const finishTwilio = () => {
    setPhase('ended')
    twilioCallRef.current = null
    deviceRef.current?.destroy()
    deviceRef.current = null
  }

  const startTwilio = async () => {
    resetForCall()
    try {
      const { token } = await apiClient.browserCallToken()
      const device = new Device(token)
      deviceRef.current = device
      device.on('error', (err: { message?: string }) => setError(err?.message || 'Call error'))

      // Sent to /twilio/clinic/inbound with the call: who to play, and whether to record
      const params: Record<string, string> = { Record: String(record) }
      if (patientId) params.PatientId = String(patientId)
      else if (callerNumber.trim()) params.CallerNumber = callerNumber.trim()
      const call = await device.connect({ params })
      twilioCallRef.current = call
      call.on('accept', () => {
        setCallSid(call.parameters.CallSid || null)
        setPhase('live')
      })
      call.on('disconnect', finishTwilio)
      call.on('cancel', finishTwilio)
      call.on('reject', finishTwilio)
      call.on('error', (err: { message?: string }) => setError(err?.message || 'Call error'))
    } catch (err) {
      setError(micError(err, 'Could not start the call.'))
      twilioCallRef.current = null
      deviceRef.current?.destroy()
      deviceRef.current = null
      setPhase('idle')
    }
  }

  const hangUp = () => {
    directRef.current?.hangUp()
    twilioCallRef.current?.disconnect()
  }

  const toggleMute = () => {
    const next = !muted
    directRef.current?.setMuted(next)
    twilioCallRef.current?.mute(next)
    setMuted(next)
  }

  if (status.isLoading) return <Loader text="Loading..." />
  if (status.error || !status.data) {
    return <ErrorState text={apiErrorMessage(status.error, 'Could not load the call settings')} />
  }

  const setup = status.data
  const inCall = phase === 'connecting' || phase === 'live'
  const ready = mode === 'direct' ? setup.direct_ready : setup.configured
  const selectedPatient = patients?.find((p) => String(p.id) === callAs)

  return (
    <div>
      <PageHeader
        title="Call the Agent"
        subtitle={`Talk to ${setup.agent_name} from this browser, as if you were phoning ${setup.clinic_name}.`}
      />

      {/* Real clinic number */}
      <Panel title="Real phone number" className="mb-5">
        <div className="space-y-2 px-5 pb-5 text-sm text-ink-soft">
          {setup.inbound_number ? (
            <p className="flex flex-wrap items-center gap-2">
              <Icon name="phoneCall" className="h-4 w-4 text-emerald-600" />
              Call <b className="font-mono text-ink">{setup.inbound_number}</b> from any phone to reach {setup.agent_name}.
            </p>
          ) : (
            <p>No clinic number yet. When you get one, no code change is needed:</p>
          )}
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Set <code className="font-mono text-ink">CLINIC_INBOUND_NUMBER</code> in backend/.env (only shown here).
            </li>
            <li>
              Twilio console → Phone Numbers → the number → Voice configuration:
              <div className="clay-inset mt-2 space-y-1 rounded-xl p-3 font-mono text-xs text-ink">
                <div className="break-all">A call comes in (POST): {setup.voice_url}</div>
                <div className="break-all">Call status changes (POST): {setup.status_url}</div>
              </div>
            </li>
          </ol>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title="Place a test call">
          <div className="space-y-4 px-5 pb-5">
            <div className="clay-sm inline-flex flex-wrap gap-1 rounded-2xl p-1" role="group" aria-label="How to call">
              {(['direct', 'twilio'] as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={inCall}
                  onClick={() => setMode(m)}
                  className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition ${
                    mode === m ? 'bg-orange-500 text-white shadow' : 'text-ink-soft hover:text-ink'
                  }`}
                >
                  {m === 'direct' ? 'Direct test (no Twilio)' : 'Through Twilio'}
                </button>
              ))}
            </div>
            <p className="text-sm text-ink-soft">
              {mode === 'direct'
                ? 'Your microphone talks straight to the agent. No Twilio account or number is needed. Nothing is recorded.'
                : 'The call goes through Twilio to the clinic-number webhook, exactly like a real phone call.'}{' '}
              Use headphones to avoid echo. The call appears in Call Logs as an inbound call.
            </p>

            {!ready && mode === 'direct' && (
              <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">
                Add to backend/.env and restart the backend: <b>{setup.direct_missing.join(', ')}</b>
              </p>
            )}
            {!ready && mode === 'twilio' && (
              <div className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">
                <p>
                  Add to backend/.env and restart the backend: <b>{setup.missing.join(', ')}</b>
                </p>
                <p className="mt-1">
                  Twilio console: create an API key, and a TwiML App whose Voice Request URL (POST) is{' '}
                  <span className="break-all font-mono text-xs">{setup.voice_url}</span>
                </p>
              </div>
            )}

            <label className="block" htmlFor="call-as">
              <span className="mb-1.5 block text-xs font-bold text-ink-soft">Call as</span>
              <select
                id="call-as"
                className="clay-input"
                value={callAs}
                disabled={inCall}
                onChange={(e) => setCallAs(e.target.value)}
              >
                <option value={NEW_CALLER}>New caller (not a patient)</option>
                {patients?.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.first_name} {p.last_name} · {p.phone_number}
                  </option>
                ))}
              </select>
            </label>

            {callAs === NEW_CALLER ? (
              <label className="block" htmlFor="caller-number">
                <span className="mb-1.5 block text-xs font-bold text-ink-soft">Caller’s phone number (optional)</span>
                <input
                  id="caller-number"
                  className="clay-input"
                  placeholder="+91 98765 43210"
                  value={callerNumber}
                  disabled={inCall}
                  onChange={(e) => setCallerNumber(e.target.value)}
                />
                <span className="mt-1 block text-xs text-ink-muted">
                  If it matches a patient’s number, the agent treats the call as coming from that number. If you ask
                  for a callback, the agent will really call this number later, so use your own or leave it empty.
                </span>
              </label>
            ) : (
              <p className="text-xs text-ink-muted">
                The agent sees the call as coming from {selectedPatient?.phone_number || 'this patient’s number'}. It
                still asks who it is speaking with before discussing their care.
              </p>
            )}

            <label className="flex cursor-pointer items-center gap-2.5 text-sm text-ink" htmlFor="record-call">
              <input
                id="record-call"
                type="checkbox"
                className="h-4 w-4 accent-orange-500"
                checked={record}
                disabled={inCall}
                onChange={(e) => {
                  setRecord(e.target.checked)
                  setRecordTouched(true)
                }}
              />
              {mode === 'direct'
                ? 'Say the recording notice (test only, nothing is recorded)'
                : 'Record this call (the agent says the call is recorded)'}
            </label>

            {error && (
              <div className="flex items-start gap-2 rounded-2xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">
                <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              {!inCall ? (
                <button
                  onClick={mode === 'direct' ? startDirect : startTwilio}
                  disabled={!ready}
                  className="clay-btn-green"
                >
                  <Icon name="phoneCall" className="h-4 w-4" />
                  {phase === 'ended' ? 'Call again' : 'Call the agent'}
                </button>
              ) : (
                <>
                  <button
                    onClick={hangUp}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-[14px] bg-rose-600 px-4 py-2 text-sm font-bold text-white"
                  >
                    <Icon name="phoneMissed" className="h-4 w-4" /> Hang up
                  </button>
                  <button onClick={toggleMute} disabled={phase !== 'live'} className="clay-btn-ghost">
                    {muted ? 'Unmute' : 'Mute'}
                  </button>
                </>
              )}
              <span className="text-sm font-semibold text-ink-soft" aria-live="polite">
                {phase === 'connecting' && 'Connecting…'}
                {phase === 'live' && (
                  <span className="inline-flex items-center gap-2 text-emerald-600">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> Live · {formatSeconds(seconds)}
                  </span>
                )}
                {phase === 'ended' && `Call ended (${formatSeconds(seconds)})`}
              </span>
            </div>
          </div>
        </Panel>

        <Panel title="Result">
          <div className="space-y-4 px-5 pb-5 text-sm">
            {phase !== 'ended' && <p className="text-ink-muted">After the call ends, its outcome and transcript appear here.</p>}
            {phase === 'ended' && !callId && !callSid && (
              <p className="text-ink-muted">The call did not connect, so there is nothing to show. Check the message and try again.</p>
            )}
            {phase === 'ended' && (callId || callSid) && !logEntry && (
              <p className="text-ink-muted">{lookupDone ? 'The call was not found in the call log yet.' : 'Finding the call in the call log…'}</p>
            )}
            {logEntry && (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <b className="text-ink">Call #{logEntry.id}</b>
                  <OutcomeBadge outcome={logEntry.outcome} />
                  {logEntry.warning_signs_detected && (
                    <span className="pill bg-rose-100 text-rose-700">
                      <Icon name="alert" className="h-3.5 w-3.5" /> Warning signs
                    </span>
                  )}
                </div>
                {logEntry.summary ? (
                  <p className="leading-relaxed text-ink-soft">{logEntry.summary}</p>
                ) : (
                  <p className="text-ink-muted">{lookupDone ? 'No summary was produced for this call.' : 'Writing the summary…'}</p>
                )}
                {logEntry.transcript && (
                  <div className="clay-inset clay-scroll max-h-80 overflow-y-auto rounded-[18px] p-4">
                    <TranscriptView transcript={logEntry.transcript} agentName={setup.agent_name} />
                  </div>
                )}
                <Link to="/calls" className="inline-flex items-center gap-1 font-bold text-orange-600 hover:underline">
                  Open Call Logs <Icon name="chevronRight" className="h-4 w-4" />
                </Link>
              </>
            )}
          </div>
        </Panel>
      </div>
    </div>
  )
}
