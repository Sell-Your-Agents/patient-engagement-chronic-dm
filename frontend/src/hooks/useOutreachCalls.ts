import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../lib/apiClient'

export interface OutreachCall {
  id: number
  patient_id: number
  care_plan_id: number | null
  call_sid: string | null
  status: string
  started_at: string | null
  ended_at: string | null
  transcript: string | null
  warning_signs_detected: boolean
  medication_adherence_reported: string | null
  csat_score: number | null
}

export interface CallStats {
  total_calls: number
  completed_calls: number
  completion_rate: number
  calls_with_warning_signs: number
  average_csat: number | null
}

export function useOutreachCalls(patientId?: number) {
  return useQuery({
    queryKey: ['outreach-calls', patientId],
    queryFn: async () => {
      const data = await apiClient.listOutreachCalls(0, 100)
      if (patientId) {
        return data.filter((call: OutreachCall) => call.patient_id === patientId)
      }
      return data as OutreachCall[]
    },
    refetchInterval: 60000, // Refetch every minute
  })
}

export function useCallStats() {
  return useQuery({
    queryKey: ['call-stats'],
    queryFn: async () => {
      const data = await apiClient.getCallStats()
      return data as CallStats
    },
    refetchInterval: 60000,
  })
}
