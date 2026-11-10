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
        className="flex items-center gap-2 rounded-full border border-[#cdd7df] bg-white py-1 pl-1 pr-3 text-sm font-bold text-[#14212e] shadow-sm transition hover:border-[#0f8f87]"
        title="User menu"
      >
        <span className="m-av !h-8 !w-8 !bg-[#12202e] !text-white text-xs font-extrabold">{initial}</span>
        <span className="hidden max-w-[140px] truncate sm:inline">{user?.name || 'User'}</span>
        <Icon name="chevronDown" className={`h-3.5 w-3.5 text-[#8fa1b3] transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="m-card absolute right-0 z-50 mt-2 w-64 p-4 shadow-xl">
            <div className="flex items-center gap-3">
              <span className="m-av !h-10 !w-10 !bg-[#12202e] !text-white font-extrabold">{initial}</span>
              <div className="min-w-0">
                <p className="truncate font-bold text-[#14212e]">{user?.name || 'Care Manager'}</p>
                <p className="truncate text-xs text-[#56646f]">{user?.email}</p>
              </div>
            </div>
            <div className="mt-3">
              <span className="m-pill m-pill-ok text-[11px] capitalize">
                {user?.role?.replace(/_/g, ' ') || 'Care Team'}
              </span>
            </div>
            <button
              onClick={() => useAuthStore.getState().logout()}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-rose-200 bg-rose-50 py-2 text-xs font-bold text-rose-700 transition hover:bg-rose-100"
            >
              <Icon name="logout" className="h-3.5 w-3.5" /> Logout
            </button>
          </div>
        </>
      )}
    </div>
  )
}
