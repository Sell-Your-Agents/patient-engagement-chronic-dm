import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../lib/apiClient'

export interface Appointment {
  id: number
  doctor_id: number | null
  doctor_name: string
  doctor_specialty: string | null
  patient_id: number | null
  patient_name: string
  phone_number: string | null
  plan_id: number | null
  call_log_id: number | null
  reason: string | null
  start_at: string | null // null until a time is agreed
  end_at: string | null
  status: string // requested | booked | confirmed | completed | cancelled
  source: string // agent | staff
  clinic_name: string
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
    refetchInterval: 10000,
  })
}

function invalidateAppointments(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['appointments'] })
  queryClient.invalidateQueries({ queryKey: ['kpis'] })
  queryClient.invalidateQueries({ queryKey: ['clinic'] })
}

export function useConfirmAppointment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => apiClient.confirmAppointment(id),
    onSuccess: () => invalidateAppointments(queryClient),
  })
}

export function useUpdateAppointment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { id: number; status: 'cancelled' | 'completed' }) =>
      apiClient.updateAppointment(data.id, data.status),
    onSuccess: () => invalidateAppointments(queryClient),
  })
}
