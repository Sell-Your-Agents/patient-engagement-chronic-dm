import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { apiClient } from '../lib/apiClient'

export type CallDirection = 'inbound' | 'outbound'

export interface Call {
  id: number
  direction: CallDirection
  phone_number: string | null
  patient_id: number | null
  patient_name: string | null
  plan_id: number | null
  call_sid: string | null
  status: string
  reason: string | null
  urgency: string | null
  outcome: string | null
  summary: string | null
  transcript: string | null
  warning_signs_detected: boolean
  medication_adherence_reported: string | null
  csat_score: number | null
  started_at: string | null
  ended_at: string | null
  duration_seconds: number | null
  created_at: string
}

export interface Callback {
  id: number
  patient_id: number | null
  plan_id: number | null
  patient_name: string | null
  phone_number: string | null
  /** Naive local clinic time */
  scheduled_time: string
  /** requested: the caller asked; staff: scheduled from the call log; retry: missed check-in */
  schedule_type: 'requested' | 'staff' | 'retry' | string
  /** calling: the agent is dialling it now; failed: nobody answered after max_attempts */
  status: 'pending' | 'calling' | 'completed' | 'cancelled' | 'failed' | string
  attempt_number: number
  max_attempts: number
  notes: string | null
  /** The call where they asked to be called back */
  source_call_log_id: number | null
  /** The latest call the agent placed for this callback */
  call_log_id: number | null
  created_at: string
}

export interface CallStats {
  total_calls: number
  completed_calls: number
  completion_rate: number
  calls_with_warning_signs: number
  average_csat: number | null
}

export function useCalls(params: { direction?: CallDirection; patient_id?: number } = {}) {
  return useQuery({
    queryKey: ['calls', params],
    queryFn: async () => (await apiClient.listCalls({ ...params, limit: 500 })) as Call[],
    // Poll quickly only while a call is live, so the live count drops to 0 soon after hang-up
    refetchInterval: (query) => ((query.state.data as Call[] | undefined)?.some(isLiveCall) ? 5000 : 30000),
  })
}

export function useCallStats(direction?: CallDirection) {
  return useQuery({
    queryKey: ['calls', 'stats', direction],
    queryFn: async () => (await apiClient.getCallStats(direction)) as CallStats,
    refetchInterval: 60000,
  })
}

export function useCallbacks() {
  return useQuery({
    queryKey: ['callbacks'],
    queryFn: async () => (await apiClient.listCallbacks()) as Callback[],
    refetchInterval: 30000,
  })
}

export function useUpdateCallback() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: number; status?: string; scheduled_time?: string }) =>
      (await apiClient.updateCallback(id, data)) as Callback,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['callbacks'] }),
  })
}

export function useFollowUpCall() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      callId,
      ...data
    }: {
      callId: number
      scheduled_time?: string
      reason?: string
      call_now?: boolean
    }) => (await apiClient.followUpCall(callId, data)) as Callback,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['callbacks'] })
      queryClient.invalidateQueries({ queryKey: ['calls'] })
    },
  })
}

export function useDialCallback() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => (await apiClient.dialCallback(id)) as Call,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['callbacks'] })
      queryClient.invalidateQueries({ queryKey: ['calls'] })
    },
  })
}

const LIVE_STATUSES = ['initiated', 'ringing', 'in-progress', 'in_progress', 'calling']
const LIVE_MAX_MS = 30 * 60 * 1000

/**
 * True while a call is actually connected or connecting. A call still marked live after
 * 30 minutes ended without a final status (the backend closes those), so it doesn't count.
 */
export function isLiveCall(c: Call) {
  if (!LIVE_STATUSES.includes(c.status)) return false
  const v = c.started_at || c.created_at
  const started = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(v) ? v : `${v}Z`).getTime()
  return Date.now() - started < LIVE_MAX_MS
}

export interface CallSearch {
  page: number
  page_size: number
  direction?: CallDirection
  /** ISO 8601 */
  date_from?: string
  date_to?: string
  name?: string
  mrn?: string
  phone?: string
}

export interface CallPage {
  items: Call[]
  total: number
  page: number
  page_size: number
  counts: { all: number; outbound: number; inbound: number }
}

/** One page of the call log, filtered and paged by the backend. */
export function useCallPage(params: CallSearch) {
  return useQuery({
    queryKey: ['calls', 'page', params],
    queryFn: async () => (await apiClient.searchCalls(params)) as CallPage,
    placeholderData: keepPreviousData,
    refetchInterval: (query) => ((query.state.data as CallPage | undefined)?.items.some(isLiveCall) ? 5000 : 30000),
  })
}
