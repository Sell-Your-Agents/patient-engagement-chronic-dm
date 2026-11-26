import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import { DirectCall } from "../lib/directCall";
import { apiErrorMessage } from "../hooks/useClinic";
import {
  INTENT_LABELS,
  LANGUAGE_LABELS,
  type CallDetail as CallLogEntry,
} from "../hooks/useCalls";
import { Icon } from "../components/Icon";
import { PageHeader, Panel, Loader, ErrorState } from "../components/ui";
import { BookingBadge, TranscriptView } from "../components/clinic";

type Phase = "idle" | "connecting" | "live" | "ended";

const LOOKUP_ATTEMPTS = 30;

function formatSeconds(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function micError(err: unknown, fallback: string) {
  const name = (err as { name?: string })?.name;
  if (name === "NotAllowedError")
    return "Microphone access was blocked. Allow the microphone for this site and try again.";
  if (name === "NotFoundError")
    return "No microphone was found. Connect one and try again.";
  return apiErrorMessage(err, fallback);
}

/**
 * Talk to the agent from the browser, as if you were phoning the clinic.
 * The call goes straight from the browser to the agent (no Twilio).
 */
export function CallAgentPage() {
  const status = useQuery({
    queryKey: ["browser-call", "status"],
    queryFn: () => apiClient.browserCallStatus(),
  });

  const [callerNumber, setCallerNumber] = useState("");
  const [record, setRecord] = useState(false);
  const [recordTouched, setRecordTouched] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [callSid, setCallSid] = useState<string | null>(null);
  const [callId, setCallId] = useState<number | null>(null);
  const [logEntry, setLogEntry] = useState<CallLogEntry | null>(null);
  const [lookupDone, setLookupDone] = useState(false);
  const directRef = useRef<DirectCall | null>(null);

  // Default the record box from the server setting until the user changes it
  useEffect(() => {
    if (status.data && !recordTouched) setRecord(status.data.recording_default);
  }, [status.data, recordTouched]);

  // Hang up and release the microphone if the user leaves the page mid-call
  useEffect(
    () => () => {
      directRef.current?.hangUp();
    },
    [],
  );

  useEffect(() => {
    if (phase !== "live") return;
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  // After the call, find it in the call log and wait for the summary (written when the call is finalized)
  useEffect(() => {
    if (phase !== "ended" || (!callId && !callSid)) return;
    let attempts = 0;
    let stopped = false;
    const done = () => {
      clearInterval(timer);
      if (!stopped) setLookupDone(true);
    };
    const timer = setInterval(async () => {
      attempts += 1;
      try {
        let id = callId;
        if (!id && callSid)
          id = ((await apiClient.callBySid(callSid)) as { id: number }).id;
        const match = id
          ? ((await apiClient.getCall(id)) as CallLogEntry)
          : null;
        if (!stopped && match) setLogEntry(match);
        if (
          (match && match.status !== "in-progress" && match.summary) ||
          attempts >= LOOKUP_ATTEMPTS
        )
          done();
      } catch {
        if (attempts >= LOOKUP_ATTEMPTS) done();
      }
    }, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [phase, callId, callSid]);

  const resetForCall = () => {
    setError(null);
    setSeconds(0);
    setCallSid(null);
    setCallId(null);
    setLogEntry(null);
    setLookupDone(false);
    setMuted(false);
    setPhase("connecting");
  };

  const startDirect = async () => {
    resetForCall();
    // Refresh first if the access token is about to expire, so the call isn't refused mid-setup
    const token = await apiClient.getFreshToken();
    if (!token) {
      setError("Your login has expired. Log in again and retry.");
      setPhase("idle");
      return;
    }
    const call = new DirectCall({
      token,
      callerNumber: callerNumber.trim(),
      announceRecording: record,
      onConnected: ({ callId: id, callSid: sid }) => {
        setCallId(id);
        setCallSid(sid);
        setPhase("live");
      },
      onEnded: (message) => {
        directRef.current = null;
        if (message) setError(message);
        setPhase("ended");
      },
    });
    directRef.current = call;
    try {
      await call.start();
    } catch (err) {
      directRef.current = null;
      setError(micError(err, "Could not start the call."));
      setPhase("idle");
    }
  };

  const hangUp = () => {
    directRef.current?.hangUp();
  };

  const toggleMute = () => {
    const next = !muted;
    directRef.current?.setMuted(next);
    setMuted(next);
  };

  if (status.isLoading) return <Loader text="Loading..." />;
  if (status.error || !status.data) {
    return (
      <ErrorState
        text={apiErrorMessage(status.error, "Could not load the call settings")}
      />
    );
  }

  const setup = status.data;
  const inCall = phase === "connecting" || phase === "live";
  const ready = setup.direct_ready;

  return (
    <div>
      <PageHeader
        title="Call the Agent"
        subtitle={`Talk to ${setup.agent_name} from this browser, as if you were phoning ${setup.clinic_name}.`}
      />

      <div className="grid g2">
        <Panel title="Place a test call">
          <div className="space-y-4 px-5 pb-5">
            <p className="text-sm text-ink-soft">
              Your microphone talks straight to the agent. Use headphones to
              avoid echo. The call appears in Call Records like any other call.
            </p>

            {!ready && (
              <p className="warnbox">
                Add to backend/.env and restart the backend:{" "}
                <b>{setup.direct_missing.join(", ")}</b>
              </p>
            )}

            <label className="block" htmlFor="caller-number">
              <span className="mb-1.5 block text-xs font-bold text-ink-soft">
                Call from this number (optional)
              </span>
              <input
                id="caller-number"
                className="field"
                placeholder="+91 98765 43210"
                value={callerNumber}
                disabled={inCall}
                onChange={(e) => setCallerNumber(e.target.value)}
              />
              <span className="mt-1 block text-xs text-ink-muted">
                The agent treats the call as coming from this number, like
                caller ID on a real call, and offers to use it for the callback.
                Leave it empty to test a caller whose number is hidden. Nobody
                is dialled automatically.
              </span>
            </label>

            <div className="note text-[12.5px]">
              Try the scenarios from the brief: book a General Physician for
              tomorrow around 5 PM; ask whether there is a cardiologist and
              when; say you tried calling earlier and want a callback for Dr.
              Agarwal; ask to speak to a person. Answer the language question
              with English, Hindi or Telugu.
            </div>

            <label
              className="flex cursor-pointer items-center gap-2.5 text-sm text-ink"
              htmlFor="record-call"
            >
              <input
                id="record-call"
                type="checkbox"
                className="h-4 w-4 accent-brand-500"
                checked={record}
                disabled={inCall}
                onChange={(e) => {
                  setRecord(e.target.checked);
                  setRecordTouched(true);
                }}
              />
              Record this call (the caller hears the recording notice)
            </label>

            {error && (
              <div className="alertbox !items-start !text-[13px]">
                <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              {!inCall ? (
                <button
                  onClick={startDirect}
                  disabled={!ready}
                  className="btn p"
                >
                  <Icon name="phoneCall" className="h-4 w-4" />
                  {phase === "ended" ? "Call again" : "Call the agent"}
                </button>
              ) : (
                <>
                  <button
                    onClick={hangUp}
                    className="btn !border-bad !bg-bad !text-white"
                  >
                    <Icon name="phoneMissed" className="h-4 w-4" /> Hang up
                  </button>
                  <button
                    onClick={toggleMute}
                    disabled={phase !== "live"}
                    className="btn"
                  >
                    {muted ? "Unmute" : "Mute"}
                  </button>
                </>
              )}
              <span
                className="text-sm font-semibold text-ink-soft"
                aria-live="polite"
              >
                {phase === "connecting" && "Connecting…"}
                {phase === "live" && (
                  <span className="inline-flex items-center gap-2 text-ok">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-ok" />{" "}
                    Live · {formatSeconds(seconds)}
                  </span>
                )}
                {phase === "ended" && `Call ended (${formatSeconds(seconds)})`}
              </span>
            </div>
          </div>
        </Panel>

        <div>
          <Panel title="How it works" className="mb-3.5">
            <div className="space-y-3 px-5 pb-5 text-sm text-ink-soft">
              <ol className="list-decimal space-y-2 pl-5">
                <li>Optionally enter the number you are calling from.</li>
                <li>
                  Press <b className="text-ink">Call the agent</b> and allow the
                  microphone.
                </li>
                <li>
                  Talk as the customer. Press{" "}
                  <b className="text-ink">Hang up</b> when done.
                </li>
                <li>
                  The call's outcome, transcript and summary appear in the
                  Result panel below, with a link to the call log entry.
                </li>
              </ol>
              <div className="rounded-[10px] border border-dashed border-line-soft p-3">
                {logEntry ? (
                  <Link
                    to="/calls/$id"
                    params={{ id: String(logEntry.id) }}
                    search={{ from: 'call-agent' }}
                    className="font-bold text-brand-700 hover:underline"
                  >
                    Open {logEntry.call_ref} in Call Records
                  </Link>
                ) : (
                  <>
                    No call yet.{" "}
                    <Link
                      to="/calls"
                      className="font-bold text-brand-700 hover:underline"
                    >
                      Go to Calls
                    </Link>
                  </>
                )}
              </div>
            </div>
          </Panel>

          <Panel title="Result">
            <div className="space-y-4 px-5 pb-5 text-sm">
              {phase !== "ended" && (
                <p className="text-ink-muted">
                  After the call ends, its outcome and transcript appear here.
                </p>
              )}
              {phase === "ended" && !callId && !callSid && (
                <p className="text-ink-muted">
                  The call did not connect, so there is nothing to show. Check
                  the message and try again.
                </p>
              )}
              {phase === "ended" && (callId || callSid) && !logEntry && (
                <p className="text-ink-muted">
                  {lookupDone
                    ? "The call was not found in the call log yet."
                    : "Finding the call in the call log…"}
                </p>
              )}
              {logEntry && (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="text-ink">{logEntry.call_ref}</b>
                    <BookingBadge status={logEntry.booking_status} />
                    {logEntry.status === "transferred" && (
                      <span className="pill violet">Transferred</span>
                    )}
                  </div>
                  <div className="kv !grid-cols-2 text-[13px]">
                    <div>
                      <span className="lbl">Caller</span>
                      <b>
                        {logEntry.patient_saved_name ||
                          logEntry.patient_name ||
                          "—"}
                      </b>
                    </div>
                    <div>
                      <span className="lbl">Language</span>
                      <b>
                        {logEntry.language
                          ? LANGUAGE_LABELS[logEntry.language]
                          : "—"}
                      </b>
                    </div>
                    <div>
                      <span className="lbl">Intent</span>
                      <b>
                        {logEntry.intent
                          ? INTENT_LABELS[logEntry.intent] || logEntry.intent
                          : "—"}
                      </b>
                    </div>
                    <div>
                      <span className="lbl">Doctor</span>
                      <b>{logEntry.doctor_requested || "—"}</b>
                    </div>
                    <div>
                      <span className="lbl">Preferred slot</span>
                      <b>{logEntry.preferred_slot || "—"}</b>
                    </div>
                    <div>
                      <span className="lbl">Next action</span>
                      <b>{logEntry.next_action || "—"}</b>
                    </div>
                  </div>
                  {logEntry.summary ? (
                    <p className="leading-relaxed text-ink-soft">
                      {logEntry.summary}
                    </p>
                  ) : (
                    <p className="text-ink-muted">
                      {lookupDone
                        ? "No summary was produced for this call."
                        : "Writing the call record…"}
                    </p>
                  )}
                  {logEntry.turns.length > 0 && (
                    <div className="max-h-80 overflow-y-auto rounded-[10px] border border-line-soft bg-card-2 p-4">
                      <TranscriptView
                        transcript={logEntry.turns
                          .map((t) => `${t.role.toUpperCase()}: ${t.content}`)
                          .join("\n")}
                        agentName={setup.agent_name}
                      />
                    </div>
                  )}
                  <Link
                    to="/calls/$id"
                    params={{ id: String(logEntry.id) }}
                    search={{ from: 'call-agent' }}
                    className="inline-flex items-center gap-1 font-bold text-brand-700 hover:underline"
                  >
                    Open in Call Records{" "}
                    <Icon name="chevronRight" className="h-4 w-4" />
                  </Link>
                </>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
