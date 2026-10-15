// Product name and tagline, used by the sidebar and the login screen.
export const BRAND_NAME = 'PatientPulse'
export const BRAND_TAGLINE = 'AI Voice Agents'

// Heart with a pulse line, drawn in white on the orange clay tile.
function LogoGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path
        d="M16 27.5s-10.5-6.3-10.5-14A6 6 0 0 1 16 9.6a6 6 0 0 1 10.5 3.9c0 7.7-10.5 14-10.5 14z"
        fill="rgba(255,255,255,0.22)"
        stroke="#fff"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M7.5 16.5h5l1.8-3.6 2.6 6.4 2.1-4.3 1.3 1.5H25"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <span className="logo-mark" style={{ width: size, height: size }}>
      <LogoGlyph size={Math.round(size * 0.68)} />
    </span>
  )
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <LogoMark />
      {!compact && (
        <div className="min-w-0 leading-none">
          <p className="logo-text text-[19px] font-extrabold tracking-tight">{BRAND_NAME}</p>
          <p className="mt-1 truncate text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink-muted">
            {BRAND_TAGLINE}
          </p>
        </div>
      )}
    </div>
  )
}
