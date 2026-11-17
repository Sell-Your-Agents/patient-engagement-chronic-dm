import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../lib/apiClient'

export interface ClinicInfo {
  clinic_name: string
  agent_name: string
  now: string
  phone: string
  address: string
  hours: string
  fees: string
  emergency_number: string
  languages: { code: string; name: string }[]
  /** "none" = every request is pending until staff confirm */
  appointment_integration: string
  /** Callers asking for a person are transferred live */
  human_transfer: boolean
}

export interface Doctor {
  id: number
  name: string
  specialty: string
  qualification: string | null
  treats: string
  /** 0 = Monday … 6 = Sunday */
  working_days: number[]
  start_time: string
  end_time: string
  slot_minutes: number
  consultation_fee: string | null
  languages: string | null
  is_active: boolean
}

export type DoctorInput = Omit<Doctor, 'id'>

export interface KnowledgeItem {
  id: number
  /** service | faq | policy */
  category: string
  title: string
  content: string
  sort_order: number
  is_active: boolean
  updated_at: string
}

export type KnowledgeInput = Omit<KnowledgeItem, 'id' | 'updated_at'>

export function useClinicInfo() {
  return useQuery({
    queryKey: ['clinic', 'info'],
    queryFn: async () => (await apiClient.getClinicInfo()) as ClinicInfo,
    staleTime: 5 * 60 * 1000,
  })
}

export function useDoctors() {
  return useQuery({
    queryKey: ['clinic', 'doctors'],
    queryFn: async () => (await apiClient.listClinicDoctors()) as Doctor[],
  })
}

export function useSaveDoctor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number | null; data: DoctorInput }) => apiClient.saveDoctor(id, data) as Promise<Doctor>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clinic', 'doctors'] })
      qc.invalidateQueries({ queryKey: ['clinic', 'availability'] })
    },
  })
}

export function useDoctorAvailability(doctorId: number | null, days = 7) {
  return useQuery({
    queryKey: ['clinic', 'availability', doctorId, days],
    queryFn: async () => (await apiClient.getDoctorAvailability(doctorId!, days)) as string[],
    enabled: doctorId !== null,
    staleTime: 60_000,
  })
}

export function useKnowledge() {
  return useQuery({
    queryKey: ['clinic', 'knowledge'],
    queryFn: async () => (await apiClient.listKnowledge()) as KnowledgeItem[],
  })
}

export function useSaveKnowledge() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number | null; data: KnowledgeInput }) => apiClient.saveKnowledge(id, data) as Promise<KnowledgeItem>,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clinic', 'knowledge'] }),
  })
}

export function useDeleteKnowledge() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => apiClient.deleteKnowledge(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clinic', 'knowledge'] }),
  })
}

export function apiErrorMessage(err: any, fallback: string) {
  return err?.response?.data?.detail || fallback
}
