/**
 * The Six Sigma logo (PNG files in public/brand/, transparent background).
 *
 *   six-sigma-mark.png             the shield icon alone (collapsed sidebar, favicon)
 *   six-sigma-logo(-white).png     icon + "SIX SIGMA"
 *   six-sigma-wordmark(-white).png "SIX SIGMA" alone (next to the icon in the sidebar)
 *
 * The "-white" files are for dark backgrounds. With tone="auto" both versions are rendered and
 * CSS (index.css, .brand-light / .brand-dark) shows the one that matches the current theme.
 */
const BASE = `${import.meta.env.BASE_URL}brand/`

type Tone = 'auto' | 'light' | 'dark'

function ThemedImg({ file, tone, alt, className, style }: { file: string; tone: Tone; alt: string; className?: string; style?: React.CSSProperties }) {
  if (tone === 'dark') return <img src={`${BASE}${file}-white.png`} alt={alt} className={className} style={style} draggable={false} />
  if (tone === 'light') return <img src={`${BASE}${file}.png`} alt={alt} className={className} style={style} draggable={false} />
  return (
    <>
      <img src={`${BASE}${file}.png`} alt={alt} className={`brand-light ${className || ''}`} style={style} draggable={false} />
      <img src={`${BASE}${file}-white.png`} alt="" aria-hidden className={`brand-dark ${className || ''}`} style={style} draggable={false} />
    </>
  )
}

/** Icon + "SIX SIGMA". tone "dark" = on a dark background (white text). */
export function BrandLogo({ height = 40, tone = 'auto' }: { height?: number; tone?: Tone }) {
  return <ThemedImg file="six-sigma-logo" tone={tone} alt="Six Sigma" className="block w-auto select-none" style={{ height }} />
}

/** "SIX SIGMA" text alone. */
export function BrandWordmark({ height = 18, tone = 'auto' }: { height?: number; tone?: Tone }) {
  return <ThemedImg file="six-sigma-wordmark" tone={tone} alt="Six Sigma" className="block w-auto select-none" style={{ height }} />
}

/** The shield icon alone. */
export function BrandMarkImage({ size = 36 }: { size?: number }) {
  return (
    <img
      src={`${BASE}six-sigma-mark.png`}
      alt="Six Sigma"
      className="block shrink-0 select-none"
      style={{ width: size, height: size }}
      draggable={false}
    />
  )
}
