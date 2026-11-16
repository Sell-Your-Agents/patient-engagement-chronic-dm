import { create } from 'zustand'
import { Icon, type IconName } from './Icon'

export type ToastKind = 'success' | 'error' | 'info' | 'warning'

interface ToastItem {
  id: number
  kind: ToastKind
  title: string
  description?: string
  duration: number
  leaving?: boolean
}

interface ToastState {
  toasts: ToastItem[]
  push: (t: Omit<ToastItem, 'id' | 'duration'> & { duration?: number }) => number
  dismiss: (id: number) => void
}

let nextId = 1

const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = nextId++
    const duration = t.duration ?? (t.kind === 'error' ? 6000 : 4000)
    set((s) => ({ toasts: [...s.toasts.slice(-4), { ...t, id, duration }] }))
    window.setTimeout(() => get().dismiss(id), duration)
    return id
  },
  dismiss: (id) => {
    // Play the exit animation, then remove
    set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)) }))
    window.setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 200)
  },
}))

/** Fire a toast from anywhere (components, mutation callbacks, plain functions). */
export const toast = {
  success: (title: string, description?: string) => useToastStore.getState().push({ kind: 'success', title, description }),
  error: (title: string, description?: string) => useToastStore.getState().push({ kind: 'error', title, description }),
  info: (title: string, description?: string) => useToastStore.getState().push({ kind: 'info', title, description }),
  warning: (title: string, description?: string) => useToastStore.getState().push({ kind: 'warning', title, description }),
}

/** Pull the API's `detail` message out of an axios error. */
export function errorText(err: any, fallback: string) {
  const detail = err?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg
  return fallback
}

const ICONS: Record<ToastKind, { icon: IconName; tone: string; cls: string }> = {
  success: { icon: 'check' as IconName, tone: 'ok', cls: 'ok' },
  error: { icon: 'x', tone: 'bad', cls: 'bad' },
  info: { icon: 'check' as IconName, tone: 'a', cls: '' },
  warning: { icon: 'alert', tone: 'warn', cls: 'warn' },
}

export function Toaster() {
  const { toasts, dismiss } = useToastStore()
  return (
    <div className="toasts" role="region" aria-live="polite" aria-label="Notifications">
      {toasts.map((t) => {
        const s = ICONS[t.kind]
        return (
          <div key={t.id} className={`toast ${s.cls} ${t.leaving ? 'leaving' : ''}`} role="status">
            <span className={`ico ${s.tone} !h-[26px] !w-[26px] !rounded-[7px]`}>
              <Icon name={s.icon} className="h-4 w-4" strokeWidth={2.4} />
            </span>
            <div className="min-w-0 flex-1">
              <b>{t.title}</b>
              {t.description && <p>{t.description}</p>}
            </div>
            <button onClick={() => dismiss(t.id)} className="text-ink-muted hover:text-ink" title="Dismiss">
              <Icon name="x" className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
