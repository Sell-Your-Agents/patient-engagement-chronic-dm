import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../lib/apiClient'
import type { FollowUp } from './useFollowUps'

export interface Patient {
  id: number
  name: string
  phone_number: string
  /** en | hi | te */
  preferred_language: string
  notes: string | null
  created_at: string
  updated_at: string
  call_count: number
  last_call_at: string | null
  /** Why they called last time, e.g. appointment_booking */
  last_call_intent?: string | null
  open_appointments: number
}

export function usePatients(q = '') {
  return useQuery({
    queryKey: ['patients', q],
    queryFn: async () => (await apiClient.listPatients({ q: q || undefined, limit: 500 })) as Patient[],
  })
}

export function usePatient(id: number) {
  return useQuery({
    queryKey: ['patient', id],
    queryFn: async () => (await apiClient.getPatient(id)) as Patient,
    enabled: id > 0,
  })
}

export function usePatientFollowUps(id: number) {
  return useQuery({
    queryKey: ['patient', id, 'follow-ups'],
    queryFn: async () => (await apiClient.patientFollowUps(id)) as FollowUp[],
    enabled: id > 0,
  })
}

export function useCreatePatient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { name: string; phone_number: string; preferred_language?: string; notes?: string | null }) =>
      apiClient.createPatient(data) as Promise<Patient>,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['patients'] }),
  })
}

export function useUpdatePatient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: { name?: string; phone_number?: string; preferred_language?: string; notes?: string | null } }) =>
      apiClient.updatePatient(id, updates) as Promise<Patient>,
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['patients'] })
      qc.invalidateQueries({ queryKey: ['patient', id] })
    },
  })
}
