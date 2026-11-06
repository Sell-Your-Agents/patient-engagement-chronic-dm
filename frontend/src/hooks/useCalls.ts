import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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
    // Call activity changes quickly while a call is live
    refetchInterval: 5000,
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
    // A callback can be scheduled by a live call at any moment
    refetchInterval: 5000,
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
