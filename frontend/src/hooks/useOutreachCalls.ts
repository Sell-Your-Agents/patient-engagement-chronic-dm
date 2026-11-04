import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
  purpose?: string | null
  duration_seconds?: number | null
  structured_summary?: FeedbackSummary | null
}

export interface FeedbackMedication {
  name: string
  taking_as_prescribed?: boolean | null
  working?: string | null
  side_effects?: string | null
  missed_doses?: string | null
}

export interface FeedbackQuery {
  question: string
  answer_given?: string | null
  needs_doctor_followup?: boolean
}

export interface FeedbackSummary {
  summary?: string
  outcome?: string
  sentiment?: string
  symptom_status?: string
  disease_feedback?: string | null
  medications?: FeedbackMedication[]
  problems?: string[]
  patient_queries?: FeedbackQuery[]
  warning_sign_details?: string | null
  appointment_details?: string | null
  callback_requested_time?: string | null
  previous_call_id?: number | null
  previous_call_followup?: { item: string; status: string; notes?: string | null }[]
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
      const data = (await apiClient.listOutreachCalls(0, 100)) as OutreachCall[]
      if (patientId) {
        return data.filter((call) => call.patient_id === patientId)
      }
      return data
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

export interface FeedbackSchedule {
  id: number
  patient_id: number
  patient_name: string
  scheduled_time: string
  status: string
  source_outreach_call_id: number | null
  notes: string | null
  created_at: string
}

function useRefreshCalls() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: ['outreach-calls'] })
    queryClient.invalidateQueries({ queryKey: ['feedback-schedules'] })
    queryClient.invalidateQueries({ queryKey: ['call-stats'] })
  }
}

export function useFeedbackSchedules() {
  return useQuery({
    queryKey: ['feedback-schedules'],
    queryFn: async () => (await apiClient.listFeedbackSchedules()) as FeedbackSchedule[],
    refetchInterval: 30000,
  })
}

export function useFeedbackCallback() {
  const refresh = useRefreshCalls()
  return useMutation({
    mutationFn: (callId: number) => apiClient.feedbackCallback(callId),
    onSuccess: refresh,
  })
}

export function useScheduleFeedback() {
  const refresh = useRefreshCalls()
  return useMutation({
    mutationFn: ({ callId, scheduled_at, notes }: { callId: number; scheduled_at: string; notes?: string }) =>
      apiClient.scheduleFeedbackCallback(callId, { scheduled_at, notes }),
    onSuccess: refresh,
  })
}

export function useCancelFeedbackSchedule() {
  const refresh = useRefreshCalls()
  return useMutation({
    mutationFn: (scheduleId: number) => apiClient.cancelFeedbackSchedule(scheduleId),
    onSuccess: refresh,
  })
}
