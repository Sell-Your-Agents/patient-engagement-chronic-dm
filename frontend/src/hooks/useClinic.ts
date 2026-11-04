import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../lib/apiClient'

export interface ClinicInfo {
  clinic_name: string
  agent_name: string
  now: string
}

export interface ClinicStats {
  total_calls: number
  calls_completed: number
  calls_booked: number
  known_patient_calls: number
  appointments_booked: number
  appointments_today: number
  upcoming_appointments: number
  conversion_rate: number
}

export interface Doctor {
  id: number
  name: string
  specialty: string
  treats: string
  working_days: number[]
  start_time: string
  end_time: string
  slot_minutes: number
  is_active: boolean
}

// Clinic info/stats refresh a bit faster than the rest while calls are live.
const LIVE_REFRESH = 5000

export function useClinicInfo() {
  return useQuery({
    queryKey: ['clinic', 'info'],
    queryFn: async () => (await apiClient.getClinicInfo()) as ClinicInfo,
    staleTime: 5 * 60 * 1000,
  })
}

export function useClinicStats() {
  return useQuery({
    queryKey: ['clinic', 'stats'],
    queryFn: async () => (await apiClient.getClinicStats()) as ClinicStats,
    refetchInterval: LIVE_REFRESH * 2,
  })
}

export function useDoctors() {
  return useQuery({
    queryKey: ['clinic', 'doctors'],
    queryFn: async () => (await apiClient.listClinicDoctors()) as Doctor[],
  })
}

export function useDoctorAvailability(doctorId: number | null, days = 7) {
  return useQuery({
    queryKey: ['clinic', 'availability', doctorId, days],
    queryFn: async () => (await apiClient.getDoctorAvailability(doctorId!, days)) as string[],
    enabled: doctorId !== null,
  })
}

export function apiErrorMessage(err: any, fallback: string) {
  return err?.response?.data?.detail || fallback
}
