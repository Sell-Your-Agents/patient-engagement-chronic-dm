/**
 * "Back to where I came from", one level only.
 *
 * Links to a detail page add `?from=<page>` (e.g. a call opened from the Dashboard gets from=dashboard),
 * and the detail page's back button then returns there with the right name ("← Dashboard").
 * Without `from` (a refresh, a shared link, opened from its own list) the page's usual back button shows.
 *
 * Going back also brings the list back exactly as it was left: the same tab, filters, search, page and
 * scroll position. That memory lives only in this browser tab and is cleared by a refresh; opening a list
 * from the sidebar always starts fresh.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

/** Where a link was clicked: a list page, or one patient / one call. */
export type From =
  | 'dashboard'
  | 'calls'
  | 'appointments'
  | 'follow-ups'
  | 'patients'
  | 'doctors'
  | 'call-agent'
  | `patient-${number}`
  | `call-${number}`

export interface BackTarget {
  to: string
  params?: Record<string, string>
  label: string
}

const PAGES: Record<string, BackTarget> = {
  dashboard: { to: '/', label: 'Dashboard' },
  calls: { to: '/calls', label: 'All call records' },
  appointments: { to: '/appointments', label: 'Appointments' },
  'follow-ups': { to: '/follow-ups', label: 'Follow-ups' },
  patients: { to: '/patients', label: 'All patients' },
  doctors: { to: '/doctors', label: 'Doctors' },
  'call-agent': { to: '/call-agent', label: 'Call the Agent' },
}

/** Keep only a valid `from` value from the URL. */
export function parseFrom(value: unknown): From | undefined {
  if (typeof value !== 'string') return undefined
  if (value in PAGES || /^(patient|call)-\d+$/.test(value)) return value as From
  return undefined
}

/** The back button for a page opened from `from`; `fallback` when it was opened directly. */
export function backTarget(from: From | undefined, fallback: BackTarget): BackTarget {
  if (!from) return fallback
  const page = PAGES[from]
  if (page) return page
  const [kind, id] = from.split('-') as [string, string]
  if (kind === 'patient') return { to: '/patients/$id', params: { id }, label: 'Back to patient' }
  return { to: '/calls/$id', params: { id }, label: `Back to call SS-${1000 + Number(id)}` }
}

// ---------- Remembering a list while you look at something else ----------

const memory = new Map<string, Record<string, unknown>>()
const scrolls = new Map<string, number>()
// Set by a back button for a moment (the page can be drawn more than once while it opens)
let restoreFor: { path: string; until: number } | null = null
const restoring = (path: string) => !!restoreFor && restoreFor.path === path && Date.now() < restoreFor.until

/** Called by a back button: the list at `path` comes back as it was left. */
export function markRestore(path: string) {
  restoreFor = { path, until: Date.now() + 1500 }
}

/**
 * A list page's view state (tab, filters, search, page). Restored only when the user came back with a
 * back button; otherwise it starts from `initial`. `restored` tells the page not to reset to page 1.
 */
export function useListState<T extends Record<string, unknown>>(path: string, initial: T) {
  const isRestore = useRef(restoring(path) && memory.has(path))
  const [state, setState] = useState<T>(() => (isRestore.current ? { ...initial, ...(memory.get(path) as Partial<T>) } : initial))
  const latest = useRef(state)
  latest.current = state

  // A fresh visit (sidebar, link) replaces the old view, but only once the page has really stayed on screen:
  // while the app moves between pages React can draw a list once more from scratch for a split second,
  // and that throwaway copy must not wipe what the user left.
  useEffect(() => {
    if (isRestore.current) return
    const t = window.setTimeout(() => memory.set(path, latest.current), 400)
    return () => window.clearTimeout(t)
  }, [path])

  // The memory changes only when the user changes the view (never because the page was drawn again)
  const set = useCallback(
    <K extends keyof T>(key: K, value: T[K]) =>
      setState((s) => {
        if (s[key] === value) return s
        const next = { ...s, [key]: value }
        memory.set(path, next)
        return next
      }),
    [path],
  )
  return { state, set, restored: isRestore.current }
}

/** Keeps the list's scroll position, and puts it back (once the rows are on screen) when restored. */
export function useScrollMemory(path: string, restored: boolean, ready: boolean) {
  const done = useRef(!restored)
  useEffect(() => {
    if (done.current || !ready) return
    const y = scrolls.get(path) || 0
    requestAnimationFrame(() => {
      window.scrollTo(0, y)
      done.current = true
    })
  }, [path, ready])
  useEffect(() => {
    // Saved while scrolling (not on leaving, when the next page may already have moved the window)
    const save = () => {
      if (done.current) scrolls.set(path, window.scrollY)
    }
    window.addEventListener('scroll', save, { passive: true })
    return () => window.removeEventListener('scroll', save)
  }, [path])
}

/** Calls `onChange` when `key` changes, never on first show (safe when React runs effects twice in development). */
export function useOnChange(key: string, onChange: () => void) {
  const last = useRef(key)
  useEffect(() => {
    if (last.current === key) return
    last.current = key
    onChange()
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
}
