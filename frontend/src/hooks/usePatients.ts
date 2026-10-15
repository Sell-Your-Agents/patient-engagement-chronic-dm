import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../lib/apiClient'

export interface Patient {
  id: number
  mrn: string
  first_name: string
  last_name: string
  phone_number: string
  preferred_language: string
  status: string
}

export function usePatients(skip = 0, limit = 50) {
  return useQuery({
    queryKey: ['patients', skip, limit],
    queryFn: async () => {
      const data = await apiClient.listPatients(skip, limit)
      return data as Patient[]
    },
  })
}

export function usePatient(id: number) {
  return useQuery({
    queryKey: ['patient', id],
    queryFn: async () => {
      const data = await apiClient.getPatient(id)
      return data as Patient
    },
    enabled: id > 0,
  })
}

export function useInitiateCall() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: { patient_id: number; care_plan_id?: number }) => {
      return await apiClient.initiateCall(data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outreach-calls'] })
      queryClient.invalidateQueries({ queryKey: ['call-stats'] })
      queryClient.invalidateQueries({ queryKey: ['kpis'] })
    },
  })
}

export function useUpdatePatient() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      id: number
      updates: {
        first_name?: string
        last_name?: string
        phone_number?: string
        preferred_language?: string
        status?: string
      }
    }) => apiClient.updatePatient(data.id, data.updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patients'] })
    },
  })
}
