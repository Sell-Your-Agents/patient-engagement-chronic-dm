import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../lib/apiClient'

export interface AssessmentQuestion {
  id: string
  text: string
  category: string
}

export interface RedFlag {
  id: string
  description: string
  severity: string
}

export interface DiseaseProtocol {
  id: number
  version: number
  default_followup_interval_days: number
  /** Set: follow-ups repeat every N minutes instead of days (call time ignored) */
  default_followup_interval_minutes: number | null
  /** "HH:MM" clinic local time, null = keep the time of the last call */
  default_call_time: string | null
  assessment_questions: AssessmentQuestion[]
  red_flag_criteria: RedFlag[]
  education_talking_points: string[]
  medication_classes: string[]
  lab_reminder_defaults: Record<string, number> | null
  escalation_instructions: string
}

export interface DiseasePlan {
  plan_id: number
  patient_id: number
  patient_name: string
  severity: string | null
  followup_interval_days: number
  /** Set: check-ins repeat every N minutes instead of days */
  followup_interval_minutes: number | null
  next_due_date: string
  last_outreach_at: string | null
  status: string
  assigned_physician_name: string | null
  notes: string | null
}

export interface DiseaseOverview {
  id: number
  code: string
  display_name: string
  description: string | null
  protocol: DiseaseProtocol | null
  plans: DiseasePlan[]
}

export function useDiseasesOverview() {
  return useQuery({
    queryKey: ['conditions', 'overview'],
    queryFn: async () => (await apiClient.getConditionsOverview()) as DiseaseOverview[],
  })
}

export function useUpdatePlan() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { id: number; updates: Parameters<typeof apiClient.updatePlan>[1] }) =>
      apiClient.updatePlan(data.id, data.updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conditions', 'overview'] })
    },
  })
}

export function useUpdateProtocol() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { conditionId: number; updates: Parameters<typeof apiClient.updateProtocol>[1] }) =>
      apiClient.updateProtocol(data.conditionId, data.updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conditions', 'overview'] })
    },
  })
}
