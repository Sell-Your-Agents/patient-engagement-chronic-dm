/**
 * Direct browser test call: microphone <-> backend websocket, no Twilio.
 *
 * Speaks the Twilio Media Streams protocol (start / media / stop with 8 kHz mu-law audio in
 * 20 ms frames) to /api/sim-call/stream, so the backend runs exactly the same agent code as a
 * real phone call. See backend/app/routers/sim_call.py.
 */
import { API_BASE } from './paths'

const SAMPLE_RATE = 8000
const FRAME_SAMPLES = 160 // 20 ms at 8 kHz, like Twilio

// ---------- G.711 mu-law ----------
const BIAS = 0x84
const CLIP = 32635

function linearToMulaw(sample: number): number {
  let s = Math.max(-32768, Math.min(32767, Math.round(sample)))
  const sign = s < 0 ? 0x80 : 0
  if (sign) s = -s
  if (s > CLIP) s = CLIP
  s += BIAS
  let exponent = 7
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; exponent--, mask >>= 1) {
    // find the segment
  }
  const mantissa = (s >> (exponent + 3)) & 0x0f
  return ~(sign | (exponent << 4) | mantissa) & 0xff
}

function mulawToLinear(value: number): number {
  const u = ~value & 0xff
  const sign = u & 0x80
  const exponent = (u >> 4) & 0x07
  const mantissa = u & 0x0f
  const magnitude = (((mantissa << 3) + BIAS) << exponent) - BIAS
  return sign ? -magnitude : magnitude
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** ws(s)://.../api/sim-call/stream, built from the same base as the REST API. */
export function directCallUrl(): string {
  const base = new URL(API_BASE, window.location.origin)
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${base.toString().replace(/\/+$/, '')}/sim-call/stream`
}

export interface DirectCallOptions {
  token: string
  patientId: number | null
  callerNumber: string
  announceRecording: boolean
  /** The call was logged on the server (its id in Call Logs) */
  onConnected: (info: { callId: number; callSid: string }) => void
  /** The call is over (hung up by either side, or failed) */
  onEnded: (errorMessage?: string) => void
}

export class DirectCall {
  private ws: WebSocket | null = null
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private processor: ScriptProcessorNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private pending = new Float32Array(0)
  private frame: number[] = []
  private playAt = 0
  private playing = new Set<AudioBufferSourceNode>()
  private muted = false
  private ended = false
  private connected = false

  constructor(private readonly options: DirectCallOptions) {}

  async start(): Promise<void> {
    // Audio output is created inside the click, so the browser allows playback
    this.ctx = new AudioContext()
    // Microphone before the server: if it is refused, nothing is logged on the server
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    } catch (err) {
      this.ctx.close().catch(() => undefined)
      this.ctx = null
      throw err
    }
    await this.ctx.resume()

    const ws = new WebSocket(directCallUrl())
    this.ws = ws
    ws.onopen = () => {
      ws.send(JSON.stringify({
        event: 'auth',
        token: this.options.token,
        patient_id: this.options.patientId,
        caller_number: this.options.callerNumber,
        announce_recording: this.options.announceRecording,
      }))
    }
    ws.onmessage = (message) => this.handleMessage(message.data)
    ws.onerror = () => this.end('Could not reach the call server. Check that the backend is running.')
    ws.onclose = (event) => {
      if (!this.ended) this.end(this.connected || event.code === 1000 ? undefined : 'The call server closed the connection.')
    }
  }

  setMuted(muted: boolean) {
    this.muted = muted
  }

  /** Hang up from the browser side. */
  hangUp() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ event: 'stop' }))
      } catch {
        // already closing
      }
    }
    this.end()
  }

  private handleMessage(raw: unknown) {
    if (typeof raw !== 'string') return
    let data: { event?: string; message?: string; call_id?: number; call_sid?: string; media?: { payload?: string } }
    try {
      data = JSON.parse(raw)
    } catch {
      return
    }
    if (data.event === 'error') {
      this.end(data.message || 'The call could not start.')
    } else if (data.event === 'sim_call' && data.call_id && data.call_sid) {
      this.connected = true
      this.ws?.send(JSON.stringify({ event: 'connected' }))
      this.ws?.send(JSON.stringify({ event: 'start', start: { streamSid: data.call_sid } }))
      this.startMicrophone()
      this.options.onConnected({ callId: data.call_id, callSid: data.call_sid })
    } else if (data.event === 'media' && data.media?.payload) {
      this.play(fromBase64(data.media.payload))
    } else if (data.event === 'clear') {
      this.clearPlayback()
    }
  }

  /** Barge-in from the server: stop the agent audio that is queued but not yet heard. */
  private clearPlayback() {
    for (const node of this.playing) {
      try {
        node.stop()
      } catch {
        // already finished
      }
    }
    this.playing.clear()
    this.playAt = 0
  }

  private startMicrophone() {
    if (!this.ctx || !this.stream) return
    this.source = this.ctx.createMediaStreamSource(this.stream)
    this.processor = this.ctx.createScriptProcessor(2048, 1, 1)
    this.processor.onaudioprocess = (event) => {
      if (this.muted || this.ws?.readyState !== WebSocket.OPEN) return
      this.capture(event.inputBuffer.getChannelData(0))
    }
    this.source.connect(this.processor)
    this.processor.connect(this.ctx.destination) // needed for the processor to run; it outputs silence
  }

  /** Downsample microphone audio to 8 kHz, encode mu-law, send in 20 ms frames. */
  private capture(input: Float32Array) {
    const inRate = this.ctx?.sampleRate || 48000
    const ratio = inRate / SAMPLE_RATE
    const data = new Float32Array(this.pending.length + input.length)
    data.set(this.pending)
    data.set(input, this.pending.length)
    const outCount = Math.floor(data.length / ratio)
    for (let i = 0; i < outCount; i++) {
      const start = Math.floor(i * ratio)
      const end = Math.max(start + 1, Math.floor((i + 1) * ratio))
      let sum = 0
      for (let j = start; j < end; j++) sum += data[j]!
      this.frame.push(linearToMulaw((sum / (end - start)) * 32767))
      if (this.frame.length === FRAME_SAMPLES) {
        this.ws?.send(JSON.stringify({ event: 'media', media: { payload: toBase64(Uint8Array.from(this.frame)) } }))
        this.frame = []
      }
    }
    this.pending = data.slice(Math.floor(outCount * ratio))
  }

  /** Queue one 20 ms frame of the agent's voice for gap-free playback. */
  private play(bytes: Uint8Array) {
    if (!this.ctx || bytes.length === 0) return
    const buffer = this.ctx.createBuffer(1, bytes.length, SAMPLE_RATE)
    const channel = buffer.getChannelData(0)
    for (let i = 0; i < bytes.length; i++) channel[i] = mulawToLinear(bytes[i]!) / 32768
    const node = this.ctx.createBufferSource()
    node.buffer = buffer
    node.connect(this.ctx.destination)
    this.playing.add(node)
    node.onended = () => this.playing.delete(node)
    const now = this.ctx.currentTime
    if (this.playAt < now) this.playAt = now + 0.06 // small cushion after a gap
    node.start(this.playAt)
    this.playAt += buffer.duration
  }

  private end(errorMessage?: string) {
    if (this.ended) return
    this.ended = true
    if (this.processor) this.processor.onaudioprocess = null
    try {
      this.source?.disconnect()
      this.processor?.disconnect()
    } catch {
      // already disconnected
    }
    this.stream?.getTracks().forEach((track) => track.stop())
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) {
      try {
        this.ws.close(1000)
      } catch {
        // already closed
      }
    }
    this.ctx?.close().catch(() => undefined)
    this.options.onEnded(errorMessage)
  }
}
