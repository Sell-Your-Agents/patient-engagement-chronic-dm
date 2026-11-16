import { useThemeStore, resolvedMode, type Accent, type Mode } from '../store/themeStore'
import { useAuthStore } from '../store/authStore'
import { useClinicInfo } from '../hooks/useClinic'
import { Icon, type IconName } from '../components/Icon'
import { PageHeader, Panel, Avatar } from '../components/ui'
import { toast } from '../components/toast'

const ACCENTS: { key: Accent; name: string; note: string; color: string; tint: string }[] = [
  { key: 'green', name: 'Green & white', note: 'Default clinic theme', color: '#0f8f87', tint: '#e6f4f3' },
  { key: 'blue', name: 'Blue & white', note: 'Zensark blue', color: '#2a4fbf', tint: '#eaeffa' },
]

const MODES: { key: Mode; name: string; note: string; icon: IconName }[] = [
  { key: 'light', name: 'Light', note: 'White workspace', icon: 'sun' },
  { key: 'dark', name: 'Dark', note: 'Easier on the eyes at night', icon: 'moon' },
  { key: 'system', name: 'System', note: 'Follow this device', icon: 'monitor' },
]

const SHORTCUTS: [string, string][] = [
  ['1 – 9', 'Jump to a page in the sidebar'],
  ['/', 'Search patients'],
  ['Ctrl K', 'Command palette'],
  ['S', 'Scheduled callbacks'],
  ['B', 'Appointments'],
  ['T', 'Toggle dark mode'],
  ['[', 'Collapse / expand sidebar'],
  ['Esc', 'Close a panel'],
]

export function SettingsPage() {
  const { accent, mode, setAccent, setMode } = useThemeStore()
  const { user } = useAuthStore()
  const { data: info } = useClinicInfo()
  const dark = resolvedMode(mode) === 'dark'

  return (
    <div>
      <PageHeader title="Settings" subtitle="Appearance is saved on this device." />

      <div className="grid g2 mb-3.5">
        <Panel title="Colour theme" subtitle="Accent used for buttons, the active page and charts">
          <div className="grid gap-3 px-[18px] pb-[18px] sm:grid-cols-2">
            {ACCENTS.map((a) => (
              <button
                key={a.key}
                className={`swatch ${accent === a.key ? 'on' : ''}`}
                onClick={() => {
                  setAccent(a.key)
                  toast.success(`${a.name} theme on`)
                }}
              >
                <span className="prev" style={{ background: dark ? '#171a21' : '#fff' }}>
                  <i style={{ background: dark ? '#12151c' : '#fff', borderRight: '1px solid var(--line)', display: 'grid', alignContent: 'start', gap: 3, padding: '6px 3px' }}>
                    <i style={{ height: 4, borderRadius: 2, background: a.color }} />
                    <i style={{ height: 4, borderRadius: 2, background: 'var(--line)' }} />
                    <i style={{ height: 4, borderRadius: 2, background: 'var(--line)' }} />
                  </i>
                  <i style={{ padding: 6, display: 'grid', gap: 4, alignContent: 'start' }}>
                    <i style={{ height: 8, borderRadius: 3, background: a.tint }} />
                    <i style={{ height: 6, width: '60%', borderRadius: 3, background: a.color }} />
                  </i>
                </span>
                <span className="min-w-0 flex-1">
                  <b>{a.name}</b>
                  <small>{a.note}</small>
                </span>
                {accent === a.key && (
                  <span className="ico a !h-6 !w-6 !rounded-full">
                    <Icon name="check" className="h-3.5 w-3.5" strokeWidth={3} />
                  </span>
                )}
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="Mode" subtitle="Light, dark, or follow the device setting">
          <div className="grid gap-3 px-[18px] pb-[18px] sm:grid-cols-3">
            {MODES.map((m) => (
              <button key={m.key} className={`swatch ${mode === m.key ? 'on' : ''}`} onClick={() => setMode(m.key)}>
                <span className={`ico ${mode === m.key ? 'a' : 'mute'}`}>
                  <Icon name={m.icon} className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0">
                  <b>{m.name}</b>
                  <small>{m.note}</small>
                </span>
              </button>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid g2">
        <Panel title="Your account">
          <div className="flex items-center gap-3.5 px-[18px] pb-4">
            <Avatar name={user?.name} size={48} />
            <div className="min-w-0">
              <b className="block text-[16px]">{user?.name}</b>
              <span className="text-[13px] text-ink-muted">{user?.email}</span>
            </div>
            <span className="pill acc ml-auto capitalize">{user?.role?.replace(/_/g, ' ') || 'staff'}</span>
          </div>
          <div className="flagrow">
            <span className="text-ink-soft">Clinic</span>
            <b>{info?.clinic_name || '—'}</b>
          </div>
          <div className="flagrow">
            <span className="text-ink-soft">AI agent</span>
            <b>{info?.agent_name || '—'}</b>
          </div>
          <div className="flagrow">
            <span className="text-ink-soft">Session</span>
            <button className="btn sm d" onClick={() => useAuthStore.getState().logout()}>
              <Icon name="logout" className="h-3.5 w-3.5" /> Sign out
            </button>
          </div>
        </Panel>

        <Panel title="Keyboard shortcuts" subtitle="Work without the mouse">
          {SHORTCUTS.map(([k, d]) => (
            <div key={k} className="flagrow">
              <span className="text-ink-soft">{d}</span>
              <kbd className="k">{k}</kbd>
            </div>
          ))}
        </Panel>
      </div>
    </div>
  )
}
