import { useEffect, useRef, useState } from 'react'

export type RowMenuItem = { label: string; onClick: () => void; danger?: boolean; disabled?: boolean }

/** A small "⋯" button that opens a list of extra actions. Clicking elsewhere, scrolling or Esc closes it. */
export function RowMenu({ items, label = 'More actions' }: { items: RowMenuItem[]; label?: string }) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!pos) return
    const close = (e: Event) => {
      const t = e.target as Node
      if (menuRef.current?.contains(t) || buttonRef.current?.contains(t)) return
      setPos(null)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPos(null)
    const shut = () => setPos(null)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', shut, true)
    window.addEventListener('resize', shut)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', shut, true)
      window.removeEventListener('resize', shut)
    }
  }, [pos])

  if (items.length === 0) return null

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (pos) return setPos(null)
    const r = buttonRef.current!.getBoundingClientRect()
    setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) })
  }

  return (
    <>
      <button ref={buttonRef} type="button" className="btn sm !px-2.5" onClick={toggle} aria-label={label} aria-expanded={!!pos} title={label}>
        ⋯
      </button>
      {pos && (
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-50 min-w-[160px] rounded-[10px] border border-line bg-card p-1 shadow-lift"
          style={{ top: pos.top, right: pos.right }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={`block w-full rounded-[7px] px-3 py-2 text-left text-[13px] font-semibold hover:bg-card-2 disabled:opacity-40 ${item.danger ? 'text-bad' : 'text-ink'}`}
              onClick={(e) => {
                e.stopPropagation()
                setPos(null)
                item.onClick()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
