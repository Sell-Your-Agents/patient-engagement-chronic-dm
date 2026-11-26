import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../lib/apiClient'

export interface Appointment {
  id: number
  doctor_id: number | null
  doctor_name: string
  doctor_specialty: string | null
  /** The doctor or specialty as the caller asked for it */
  doctor_requested: string | null
  patient_id: number | null
  patient_name: string
  phone_number: string | null
  call_log_id: number | null
  call_ref: string | null
  reason: string | null
  /** The caller's preferred time in words */
  preferred_time: string | null
  /** Visit day and rough arrival time (clinic-local), null until a day is set */
  start_at: string | null
  end_at: string | null
  /** pending | confirmed | cancel_requested (patient asked to cancel) | cancelled | completed */
  status: string
  /** agent | staff */
  source: string
  staff_notes: string | null
  /** Last change the patient made by phone, e.g. "Moved by patient: was Fri 21 Nov, around 2 PM" */
  change_note: string | null
  confirmed_at: string | null
  created_at: string
  /** Summary of the call the agent recorded this on (the conversation context); null until summarised */
  call_summary?: string | null
  /** When that call happened (UTC) */
  call_at?: string | null
  /** en | hi | te */
  call_language?: string | null
  /** Name on the patient record (patient_name is the name as heard on the call) */
  patient_saved_name?: string | null
}

export interface AppointmentParams {
  patient_id?: number
  doctor_id?: number
  status?: string
  source?: string
  date_from?: string
  date_to?: string
}

export function useAppointments(params: AppointmentParams = {}) {
  return useQuery({
    queryKey: ['appointments', params],
    queryFn: async () => (await apiClient.listAppointments(params)) as Appointment[],
    refetchInterval: 20000,
  })
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['appointments'] })
  qc.invalidateQueries({ queryKey: ['follow-ups'] })
  qc.invalidateQueries({ queryKey: ['notifications'] })
  qc.invalidateQueries({ queryKey: ['dashboard'] })
}

export function useUpdateAppointment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; status?: string; doctor_id?: number; start_at?: string; staff_notes?: string }) =>
      apiClient.updateAppointment(id, data) as Promise<Appointment>,
    onSuccess: () => invalidateAll(qc),
  })
}

export function useCreateAppointment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { patient_name: string; phone_number: string; doctor_id: number; start_at: string; reason?: string; confirmed?: boolean }) =>
      apiClient.createAppointment(data) as Promise<Appointment>,
    onSuccess: () => invalidateAll(qc),
  })
}
