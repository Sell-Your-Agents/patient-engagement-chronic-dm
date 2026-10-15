import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../lib/apiClient'

export interface ClinicInfo {
  clinic_name: string
  agent_name: string
  now: string
}

export interface ClinicStats {
  total_missed_calls: number
  pending_callbacks: number
  callbacks_made: number
  callbacks_connected: number
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

export interface MissedCall {
  id: number
  phone_number: string
  caller_name: string | null
  missed_at: string
  notes: string | null
  status: string
  attempts: number
  last_attempt_at: string | null
  created_at: string
}

export interface ClinicCall {
  id: number
  missed_call_id: number
  phone_number: string
  call_sid: string | null
  status: string
  started_at: string | null
  ended_at: string | null
  duration_seconds: number | null
  transcript: string | null
  patient_name: string | null
  reason: string | null
  urgency: string | null
  outcome: string | null
  summary: string | null
  created_at: string
}

export interface ClinicAppointment {
  id: number
  doctor_id: number
  doctor_name: string
  doctor_specialty: string
  missed_call_id: number | null
  clinic_call_id: number | null
  patient_name: string
  phone_number: string
  reason: string | null
  start_at: string
  end_at: string
  status: string
  booked_via: string
  clinic_name: string
  created_at: string
}

// Callback activity changes quickly while a call is live, so poll a bit faster.
const LIVE_REFRESH = 5000

function invalidateClinic(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['clinic'] })
}

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

export function useMissedCalls() {
  return useQuery({
    queryKey: ['clinic', 'missed-calls'],
    queryFn: async () => (await apiClient.listMissedCalls()) as MissedCall[],
    refetchInterval: LIVE_REFRESH,
  })
}

export function useClinicCalls() {
  return useQuery({
    queryKey: ['clinic', 'calls'],
    queryFn: async () => (await apiClient.listClinicCalls()) as ClinicCall[],
    refetchInterval: LIVE_REFRESH,
  })
}

export function useClinicAppointments(params: {
  date_from?: string
  date_to?: string
  doctor_id?: number
  status?: string
} = {}) {
  return useQuery({
    queryKey: ['clinic', 'appointments', params],
    queryFn: async () => (await apiClient.listClinicAppointments(params)) as ClinicAppointment[],
    refetchInterval: LIVE_REFRESH * 2,
  })
}

export function useCreateMissedCall() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { phone_number: string; caller_name?: string; missed_at?: string; notes?: string }) =>
      apiClient.createMissedCall(data) as Promise<MissedCall>,
    onSuccess: () => invalidateClinic(queryClient),
  })
}

export function useDeleteMissedCall() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => apiClient.deleteMissedCall(id),
    onSuccess: () => invalidateClinic(queryClient),
  })
}

export function useStartCallback() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (missedCallId: number) => apiClient.startCallback(missedCallId) as Promise<ClinicCall>,
    onSettled: () => invalidateClinic(queryClient),
  })
}

export function useUpdateClinicAppointment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { id: number; status: 'cancelled' | 'completed' }) =>
      apiClient.updateClinicAppointment(data.id, data.status),
    onSuccess: () => invalidateClinic(queryClient),
  })
}

export function apiErrorMessage(err: any, fallback: string) {
  return err?.response?.data?.detail || fallback
}
