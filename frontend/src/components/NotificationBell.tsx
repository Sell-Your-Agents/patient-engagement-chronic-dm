import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useNotifications, useMarkNotificationsRead, useClearNotifications, type AppNotification } from '../hooks/useNotifications'
import { Icon, type IconName } from './Icon'

type Tab = 'all' | 'unread'

const GROUP_ICON: Record<AppNotification['group'], IconName> = {
  clinical: 'alert',
  callback: 'phoneCall',
  appointment: 'calendar',
}
const SEV_TONE: Record<AppNotification['severity'], string> = {
  urgent: 'bad',
  high: 'warn',
  medium: 'info',
  low: 'mute',
  info: 'a',
}

function ago(iso: string) {
  const d = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`)
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h} h ago`
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function dayGroup(iso: string) {
  const d = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`)
  const today = new Date()
  const y = new Date(today)
  y.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return 'Earlier'
}

export function NotificationBell() {
  const navigate = useNavigate()
  const { data } = useNotifications()
  const markRead = useMarkNotificationsRead()
  const clear = useClearNotifications()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('all')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const items = data?.items || []
  const unread = data?.unread || 0
  const shown = tab === 'unread' ? items.filter((n) => !n.read) : items
  const groups: { label: string; rows: AppNotification[] }[] = []
  for (const n of shown) {
    const label = dayGroup(n.at)
    const g = groups.find((x) => x.label === label)
    if (g) g.rows.push(n)
    else groups.push({ label, rows: [n] })
  }

  const openItem = (n: AppNotification) => {
    if (!n.read) markRead.mutate([n.key])
    setOpen(false)
    if (n.group === 'callback') {
      ;(window as unknown as { __ppOpenCallbacks?: boolean }).__ppOpenCallbacks = true
      navigate({ to: '/calls' })
      window.dispatchEvent(new Event('open-callbacks'))
    } else navigate({ to: n.link })
  }

  return (
    <div className="relative" ref={ref}>
      <button className="ibtn" onClick={() => setOpen((o) => !o)} title={unread ? `${unread} unread notifications` : 'Notifications'} aria-expanded={open}>
        <Icon name="bell" className="h-[18px] w-[18px]" />
        {unread > 0 && <span className="n">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="notif" role="dialog" aria-label="Notifications">
          <div className="notif-h">
            <b>Notifications</b>
            <div className="flex items-center gap-3">
              <button className="text-[12.5px] font-bold text-brand disabled:opacity-40" disabled={!unread} onClick={() => markRead.mutate('all')}>
                Mark all read
              </button>
              <span className="h-3.5 w-px bg-line" aria-hidden="true" />
              <button className="text-[12.5px] font-bold text-bad disabled:opacity-40" disabled={!items.length} onClick={() => clear.mutate('all')}>
                Clear all
              </button>
            </div>
          </div>
          <div className="notif-tabs">
            {(
              [
                ['all', 'All', items.length],
                ['unread', 'Unread', unread],
              ] as const
            ).map(([k, l, n]) => (
              <button key={k} className={`tab !h-8 ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>
                {l} {n > 0 && <span className="c">{n}</span>}
              </button>
            ))}
          </div>
          <div className="notif-list">
            {shown.length === 0 ? (
              <div className="empty flex flex-col items-center gap-2">
                <span className="ico ok !h-10 !w-10">
                  <Icon name="checkCircle" className="h-5 w-5" />
                </span>
                {tab === 'unread' ? 'No unread notifications.' : 'You are all caught up.'}
              </div>
            ) : (
              groups.map((g) => (
                <div key={g.label}>
                  <div className="notif-day">{g.label}</div>
                  {g.rows.map((n) => (
                    <div key={n.key} className={`notif-item ${n.read ? '' : 'unread'}`} onClick={() => openItem(n)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openItem(n)}>
                      <span className={`ico ${SEV_TONE[n.severity]} !h-8 !w-8`}>
                        <Icon name={n.kind === 'callback_failed' ? 'phoneMissed' : n.kind === 'escalation_overdue' ? 'clock' : GROUP_ICON[n.group]} className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <b className="text-[13px] leading-snug">{n.title}</b>
                          <small className="shrink-0 text-[11px] text-ink-muted">{ago(n.at)}</small>
                        </div>
                        <p className="line-clamp-2 text-[12.5px] leading-snug text-ink-soft">{n.body}</p>
                      </div>
                      {!n.read && <span className="notif-dot" aria-label="Unread" />}
                      <button
                        className="notif-x"
                        title="Clear this notification"
                        aria-label="Clear this notification"
                        onClick={(e) => {
                          e.stopPropagation()
                          clear.mutate([n.key])
                        }}
                      >
                        <Icon name="x" className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
