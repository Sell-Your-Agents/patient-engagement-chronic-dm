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
  /** Clinic-local time, null until a slot is set */
  start_at: string | null
  end_at: string | null
  /** pending | confirmed | cancelled | completed */
  status: string
  /** agent | staff */
  source: string
  staff_notes: string | null
  confirmed_at: string | null
  created_at: string
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
  qc.invalidateQueries({ queryKey: ['clinic', 'availability'] })
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
