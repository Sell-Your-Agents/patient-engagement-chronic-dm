import { create } from 'zustand'

export type Accent = 'green' | 'blue'
export type Mode = 'light' | 'dark' | 'system'

const ACCENT_KEY = 'pp_accent'
const MODE_KEY = 'pp_mode'

function read<T extends string>(key: string, allowed: T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null
    return v && allowed.includes(v) ? v : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // storage blocked: the choice simply isn't remembered
  }
}

const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null

/** Resolve "system" to the OS preference. */
export function resolvedMode(mode: Mode): 'light' | 'dark' {
  if (mode === 'system') return media?.matches ? 'dark' : 'light'
  return mode
}

/** Push the current choice onto <html> so every CSS token switches at once. */
function apply(accent: Accent, mode: Mode) {
  const root = document.documentElement
  root.dataset.accent = accent
  root.dataset.theme = resolvedMode(mode)
}

interface ThemeState {
  accent: Accent
  mode: Mode
  setAccent: (a: Accent) => void
  setMode: (m: Mode) => void
  /** Header toggle: flips between light and dark. */
  toggleMode: () => void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  accent: read<Accent>(ACCENT_KEY, ['green', 'blue'], 'green'),
  mode: read<Mode>(MODE_KEY, ['light', 'dark', 'system'], 'light'),
  setAccent: (accent) => {
    write(ACCENT_KEY, accent)
    apply(accent, get().mode)
    set({ accent })
  },
  setMode: (mode) => {
    write(MODE_KEY, mode)
    apply(get().accent, mode)
    set({ mode })
  },
  toggleMode: () => get().setMode(resolvedMode(get().mode) === 'dark' ? 'light' : 'dark'),
}))

/** Call once before the first render. */
export function initTheme() {
  const { accent, mode } = useThemeStore.getState()
  apply(accent, mode)
  media?.addEventListener('change', () => {
    const s = useThemeStore.getState()
    if (s.mode === 'system') apply(s.accent, 'system')
  })
}
