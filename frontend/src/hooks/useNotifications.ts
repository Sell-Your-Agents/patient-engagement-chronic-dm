import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../lib/apiClient'

export type NotificationGroup = 'clinical' | 'callback' | 'appointment'
export type NotificationAction = 'acknowledge' | 'call_now' | 'confirm'

export interface AppNotification {
  key: string
  group: NotificationGroup
  kind: 'escalation' | 'escalation_overdue' | 'callback_due' | 'callback_failed' | 'appointment_request' | string
  severity: 'urgent' | 'high' | 'medium' | 'low' | 'info'
  title: string
  body: string
  /** UTC ISO time */
  at: string
  link: string
  ref_id: number
  action: NotificationAction | null
  needs_action: boolean
  read: boolean
}

export interface NotificationList {
  items: AppNotification[]
  unread: number
  unread_needs_action: number
}

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: async () => (await apiClient.listNotifications()) as NotificationList,
    refetchInterval: 30000,
  })
}

/** Mark notifications read. Updates the cached list straight away so the badge drops instantly. */
export function useMarkNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (keys: string[] | 'all') => (keys === 'all' ? apiClient.markAllNotificationsRead() : apiClient.markNotificationsRead(keys)),
    onMutate: (keys) => {
      qc.setQueryData<NotificationList>(['notifications'], (old) => {
        if (!old) return old
        const items = old.items.map((n) => (keys === 'all' || keys.includes(n.key) ? { ...n, read: true } : n))
        const unread = items.filter((n) => !n.read)
        return { items, unread: unread.length, unread_needs_action: unread.filter((n) => n.needs_action).length }
      })
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

/** Remove notifications from this user's list (they stay cleared). Nothing clinical changes. */
export function useClearNotifications() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (keys: string[] | 'all') => (keys === 'all' ? apiClient.clearAllNotifications() : apiClient.clearNotifications(keys)),
    onMutate: (keys) => {
      qc.setQueryData<NotificationList>(['notifications'], (old) => {
        if (!old) return old
        const items = keys === 'all' ? [] : old.items.filter((n) => !keys.includes(n.key))
        const unread = items.filter((n) => !n.read)
        return { items, unread: unread.length, unread_needs_action: unread.filter((n) => n.needs_action).length }
      })
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}
