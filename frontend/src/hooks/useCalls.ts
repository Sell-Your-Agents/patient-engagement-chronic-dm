import { useQuery } from '@tanstack/react-query'
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
