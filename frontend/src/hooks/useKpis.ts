import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../lib/apiClient'

/** Everything the dashboard shows (GET /api/analytics/dashboard). */
export interface DashboardData {
  days: number
  calls_today: number
  calls_period: number
  total_calls: number
  live_calls: number
  avg_call_seconds: number | null
  appointment_requests_period: number
  /** Appointment requests per 100 calls in the period */
  request_rate: number
  pending_appointments: number
  confirmed_upcoming: number
  pending_follow_ups: number
  urgent_follow_ups: number
  /** Waiting follow-ups by kind (appointment confirmations not included) */
  follow_ups_by_kind: Record<string, number>
  patients: number
  intents: Record<string, number>
  languages: Record<string, number>
  trend: { date: string; calls: number; requests: number }[]
  /** About the AI agent over the period */
  agent: {
    conversations: number
    handled_alone: number
    handled_alone_rate: number
    transferred: number
    follow_ups_created: number
    /** Clinic-local hour (0-23) with the most calls */
    busiest_hour: number | null
  }
}

export function useDashboard(days = 14) {
  return useQuery({
    queryKey: ['dashboard', days],
    queryFn: async () => (await apiClient.getDashboard(days)) as DashboardData,
    refetchInterval: 20000,
  })
}
