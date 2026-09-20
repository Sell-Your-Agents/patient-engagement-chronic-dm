import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../lib/apiClient'

export interface KPIs {
  total_patients_enrolled: number
  active_patients: number
  engagement_rate: number
  total_outreach_calls: number
  completed_calls: number
  call_completion_rate: number
  calls_with_warnings: number
  average_csat: number | null
  medication_adherent_calls: number
  confirmed_appointments: number
  open_escalations: number
}

export function useKpis() {
  return useQuery({
    queryKey: ['kpis'],
    queryFn: async () => {
      const data = await apiClient.getKpis()
      return data as KPIs
    },
    refetchInterval: 60000, // Refetch every minute
  })
}

export function useKpiTrend(days = 30) {
  return useQuery({
    queryKey: ['kpi-trend', days],
    queryFn: async () => {
      const data = await apiClient.getKpiTrend(days)
      return data as Array<{
        date: string
        calls_completed: number
        escalations_created: number
        average_csat: number | null
      }>
    },
    refetchInterval: 300000, // Refetch every 5 minutes
  })
}
