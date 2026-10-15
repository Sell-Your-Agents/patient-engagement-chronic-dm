import { useState } from 'react'
import { useAuthStore } from '../store/authStore'
import { Icon } from './Icon'

export function UserMenu() {
  const { user } = useAuthStore()
  const [open, setOpen] = useState(false)
  const initial = (user?.name || user?.email || '?').charAt(0).toUpperCase()

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="clay-btn-ghost !rounded-full !py-1.5 !pl-1.5 !pr-3.5"
      >
        <span className="logo-mark h-8 w-8 !rounded-full text-sm font-extrabold text-white">{initial}</span>
        <span className="hidden max-w-[140px] truncate text-sm font-bold sm:inline">{user?.name || 'User'}</span>
        <Icon name="chevronDown" className={`h-4 w-4 text-ink-muted transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="clay absolute right-0 z-20 mt-3 w-64 p-4">
            <div className="flex items-center gap-3">
              <span className="logo-mark h-10 w-10 !rounded-full font-extrabold text-white">{initial}</span>
              <div className="min-w-0">
                <p className="truncate font-bold text-ink">{user?.name}</p>
                <p className="truncate text-xs text-ink-soft">{user?.email}</p>
              </div>
            </div>
            <p className="mt-3 inline-block rounded-full bg-orange-50 px-3 py-1 text-xs font-bold capitalize text-orange-600">
              {user?.role?.replace(/_/g, ' ')}
            </p>
            <button
              onClick={() => useAuthStore.getState().logout()}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-2 text-sm font-bold text-rose-600 transition hover:bg-rose-50"
            >
              <Icon name="logout" className="h-4 w-4" /> Logout
            </button>
          </div>
        </>
      )}
    </div>
  )
}
