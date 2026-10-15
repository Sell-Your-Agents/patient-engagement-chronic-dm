import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../lib/apiClient'

export interface Appointment {
  id: number
  patient_id: number
  care_plan_id: number | null
  physician_name: string
  scheduled_at: string
  duration_minutes: number
  status: string
  reason: string | null
  created_at: string
}

export function useAppointments() {
  return useQuery({
    queryKey: ['appointments'],
    queryFn: async () => {
      const data = await apiClient.listAppointments(0, 100)
      return data as Appointment[]
    },
    refetchInterval: 60000,
  })
}

export function useConfirmAppointment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: number) => {
      return await apiClient.confirmAppointment(id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] })
      queryClient.invalidateQueries({ queryKey: ['kpis'] })
    },
  })
}
