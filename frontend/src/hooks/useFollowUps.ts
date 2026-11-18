import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../lib/apiClient'

/** A person clinic staff must call back. */
export interface FollowUp {
  id: number
  /** emergency | distress | human_assistance | unanswered_question | callback | confirm_appointment | cancel_request | rescheduled | staff */
  kind: string
  /** urgent | high | normal */
  priority: string
  /** Live transfer to the front desk: ringing | answered | not_answered */
  transfer_status: string | null
  call_log_id: number | null
  call_ref: string | null
  appointment_id: number | null
  patient_id: number | null
  patient_name: string | null
  phone_number: string | null
  doctor_requested: string | null
  preferred_time: string | null
  reason: string | null
  /** Clinic time */
  follow_up_at: string | null
  /** pending | done | cancelled */
  status: string
  staff_notes: string | null
  completed_at: string | null
  created_at: string
}

/** The call outcome behind each follow-up, in the words staff read on the list (also the filter options). */
export const FOLLOW_UP_KIND_LABELS: Record<string, string> = {
  emergency: 'Emergency: told to call 108',
  distress: 'Caller in distress',
  human_assistance: 'Asked for staff',
  unanswered_question: 'Question not answered',
  callback: 'Callback requested',
  confirm_appointment: 'Appointment request: needs confirming',
  cancel_request: 'Wants to cancel appointment',
  rescheduled: 'Patient rescheduled appointment',
  staff: 'Added by staff',
}

export const FOLLOW_UP_KIND_TONE: Record<string, string> = {
  emergency: 'bad',
  distress: 'bad',
  human_assistance: 'warn',
  unanswered_question: 'info',
  callback: 'warn',
  confirm_appointment: 'violet',
  cancel_request: 'bad',
  rescheduled: 'violet',
  staff: 'mute',
}

/** "Asked for staff" spelled out with what happened to the transfer. */
const TRANSFER_OUTCOME: Record<string, string> = {
  ringing: 'Asked for staff: transferring…',
  answered: 'Talked to staff: done',
  not_answered: 'Asked for staff: no one answered',
}

/** What happened on the call, for the "Call outcome" column. */
export function followUpOutcome(t: Pick<FollowUp, 'kind' | 'transfer_status'>) {
  if (t.kind === 'human_assistance') return TRANSFER_OUTCOME[t.transfer_status || ''] || 'Asked for staff: message taken'
  return FOLLOW_UP_KIND_LABELS[t.kind] || t.kind.replace(/_/g, ' ')
}

export function followUpOutcomeTone(t: Pick<FollowUp, 'kind' | 'transfer_status'>) {
  if (t.kind === 'human_assistance' && t.transfer_status === 'answered') return 'ok'
  return FOLLOW_UP_KIND_TONE[t.kind] || 'mute'
}

export function useFollowUps(status?: string) {
  return useQuery({
    queryKey: ['follow-ups', status ?? 'all'],
    queryFn: async () => (await apiClient.listFollowUps({ status })) as FollowUp[],
    refetchInterval: 20000,
  })
}

export function useUpdateFollowUp() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; status?: string; staff_notes?: string }) =>
      apiClient.updateFollowUp(id, data) as Promise<FollowUp>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['follow-ups'] })
      qc.invalidateQueries({ queryKey: ['patient'] })
      qc.invalidateQueries({ queryKey: ['notifications'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useCreateFollowUp() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { patient_name: string; phone_number: string; reason?: string; doctor_requested?: string; preferred_time?: string; priority?: string }) =>
      apiClient.createFollowUp(data) as Promise<FollowUp>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['follow-ups'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}
