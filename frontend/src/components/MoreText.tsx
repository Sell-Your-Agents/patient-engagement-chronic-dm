import { useEffect, useRef, useState } from 'react'

/**
 * Long text shown as one short line plus a "Show more" button. The button opens the full text in a
 * small box; clicking anywhere else, scrolling or pressing Esc closes it. Clicks inside never reach the
 * table row (so they don't open the row's details).
 */
export function MoreText({ text, limit = 48, className = '' }: { text: string | null | undefined; limit?: number; className?: string }) {
  const [box, setBox] = useState<{ top: number; left: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const value = (text || '').trim()

  useEffect(() => {
    if (!box) return
    const close = (e: Event) => {
      const target = e.target as Node
      if (boxRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      setBox(null)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setBox(null)
    const onScroll = () => setBox(null)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [box])

  if (!value) return <span className="text-ink-muted">—</span>
  if (value.length <= limit) return <span className={`block truncate ${className}`} title={value}>{value}</span>

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (box) return setBox(null)
    const r = buttonRef.current!.getBoundingClientRect()
    const width = Math.min(340, window.innerWidth - 24)
    setBox({ top: r.bottom + 6, left: Math.max(12, Math.min(r.left, window.innerWidth - width - 12)) })
  }

  return (
    <span className={`block min-w-0 ${className}`} onClick={(e) => box && e.stopPropagation()}>
      <span className="block truncate">{value}</span>
      <button
        ref={buttonRef}
        type="button"
        className="mt-0.5 text-[12px] font-bold text-brand hover:underline"
        onClick={toggle}
        aria-expanded={!!box}
      >
        {box ? 'Show less' : 'Show more'}
      </button>
      {box && (
        <div
          ref={boxRef}
          role="dialog"
          className="fixed z-50 rounded-[10px] border border-line bg-card p-3 text-[13px] leading-relaxed text-ink shadow-lift"
          style={{ top: box.top, left: box.left, width: Math.min(340, window.innerWidth - 24) }}
          onClick={(e) => e.stopPropagation()}
        >
          {value}
        </div>
      )}
    </span>
  )
}
