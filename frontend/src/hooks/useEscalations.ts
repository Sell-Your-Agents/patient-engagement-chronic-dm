import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../lib/apiClient'

export interface Escalation {
  id: number
  outreach_call_id: number
  patient_id: number
  reason: string
  severity: string
  status: string
  assigned_to_user_id: number | null
  resolution_notes: string | null
  created_at: string
  acknowledged_at: string | null
  resolved_at: string | null
}

export function useEscalations() {
  return useQuery({
    queryKey: ['escalations'],
    queryFn: async () => {
      const data = await apiClient.listEscalations(0, 100)
      return data as Escalation[]
    },
    refetchInterval: 30000, // Refetch every 30 seconds
  })
}

export function useEscalation(id: number) {
  return useQuery({
    queryKey: ['escalation', id],
    queryFn: async () => {
      const data = await apiClient.getEscalation(id)
      return data as Escalation
    },
  })
}

export function useUpdateEscalation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: {
      id: number
      status?: string
      assigned_to_user_id?: number
      resolution_notes?: string
    }) => {
      const { id, ...updateData } = data
      return await apiClient.updateEscalation(id, updateData)
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['escalations'] })
      queryClient.invalidateQueries({ queryKey: ['escalation', variables.id] })
      queryClient.invalidateQueries({ queryKey: ['kpis'] })
    },
  })
}
