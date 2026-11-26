import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { apiClient } from '../lib/apiClient'

/** One call to the clinic and its structured call record. */
export interface Call {
  id: number
  /** SS-1001 */
  call_ref: string
  channel: 'phone' | 'browser' | string
  phone_number: string | null
  patient_id: number | null
  /** The name said on this call */
  patient_name: string | null
  /** The saved patient's name: the same on every call from that patient (null for unknown callers) */
  patient_saved_name?: string | null
  /** in-progress | completed | transferred | failed */
  status: string
  /** en | hi | te */
  language: string | null
  intent: string | null
  doctor_requested: string | null
  preferred_slot: string | null
  reason: string | null
  outcome: string | null
  /** confirmed | pending | not_applicable */
  booking_status: string | null
  next_action: string | null
  urgency: string | null
  summary: string | null
  started_at: string | null
  ended_at: string | null
  duration_seconds: number | null
  created_at: string
  /** Set when the call was recorded (staff play it via apiClient.callRecording) */
  recording_url?: string | null
}

export interface CallTurn {
  role: string
  content: string
  timestamp: string
}

export interface CallDetail extends Call {
  transcript: string | null
  structured_summary: Record<string, unknown> | null
  turns: CallTurn[]
  linked: {
    id: number
    kind: 'appointment' | 'follow_up'
    status: string
    label: string
    detail?: string | null
    follow_up_kind?: string | null
    priority?: string | null
    transfer_status?: string | null
  }[]
}

export interface CallSearch {
  page: number
  page_size: number
  q?: string
  intent?: string
  language?: string
  booking_status?: string
  patient_id?: number
  date_from?: string
  date_to?: string
  /** Leave out calls still in progress */
  finished_only?: boolean
}

export interface CallPage {
  items: Call[]
  total: number
  page: number
  page_size: number
}

export const INTENT_LABELS: Record<string, string> = {
  appointment_booking: 'Appointment booking',
  appointment_change: 'Reschedule / cancel appointment',
  doctor_enquiry: 'Doctor / specialty enquiry',
  clinic_info: 'Clinic timings / services',
  missed_call_callback: 'Missed-call callback',
  human_assistance: 'Human assistance',
  emergency: 'Emergency',
  other: 'Other',
}

export const LANGUAGE_LABELS: Record<string, string> = { en: 'English', hi: 'Hindi', te: 'Telugu' }

export function useCallPage(params: CallSearch) {
  return useQuery({
    queryKey: ['calls', 'page', params],
    queryFn: async () => (await apiClient.searchCalls(params)) as CallPage,
    placeholderData: keepPreviousData,
    refetchInterval: 15000,
  })
}

export function useLiveCalls() {
  return useQuery({
    queryKey: ['calls', 'live'],
    queryFn: async () => (await apiClient.liveCalls()) as Call[],
    refetchInterval: 5000,
  })
}

export function useCall(id: number | null) {
  return useQuery({
    queryKey: ['call', id],
    queryFn: async () => (await apiClient.getCall(id!)) as CallDetail,
    enabled: id !== null && id > 0,
    // A live call refreshes every 2 seconds, so new sentences appear almost as they are said. Just after it
    // ends, keep checking for a minute until the summary and call record have been written.
    refetchInterval: (query) => {
      const c = query.state.data
      if (!c) return false
      if (c.status === 'in-progress') return 2000
      const ended = c.ended_at ? Date.now() - new Date(/[zZ]|[+-]\d\d:\d\d$/.test(c.ended_at) ? c.ended_at : `${c.ended_at}Z`).getTime() : Infinity
      return !c.summary && c.turns.length > 0 && ended < 60_000 ? 3000 : false
    },
  })
}

/** One name per person: the saved patient name when there is one, else the name said on the call. */
export function callerName(c: Pick<Call, 'patient_saved_name' | 'patient_name'>) {
  return c.patient_saved_name || c.patient_name || null
}

export function isLiveCall(c: Call) {
  return c.status === 'in-progress'
}
