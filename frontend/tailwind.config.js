export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Lato', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      // All colours come from the CSS variables in index.css so the accent
      // (green / blue) and the mode (light / dark) switch everything at once.
      colors: {
        ink: { DEFAULT: 'var(--ink)', soft: 'var(--ink-2)', muted: 'var(--ink-3)' },
        line: { DEFAULT: 'var(--line)', soft: 'var(--line-2)' },
        page: 'var(--bg)',
        card: { DEFAULT: 'var(--card)', 2: 'var(--card-2)' },
        brand: {
          DEFAULT: 'var(--accent)',
          50: 'var(--accent-bg)',
          100: 'var(--accent-bg)',
          200: 'var(--accent-line)',
          400: 'var(--accent-2)',
          500: 'var(--accent)',
          600: 'var(--accent-2)',
          700: 'var(--accent-ink)',
          800: 'var(--accent-ink)',
        },
        ok: { DEFAULT: 'var(--ok)', bg: 'var(--ok-bg)' },
        warn: { DEFAULT: 'var(--warn)', bg: 'var(--warn-bg)' },
        bad: { DEFAULT: 'var(--bad)', bg: 'var(--bad-bg)' },
        info: { DEFAULT: 'var(--info)', bg: 'var(--info-bg)' },
        violet: { DEFAULT: 'var(--violet)', bg: 'var(--violet-bg)' },
      },
      boxShadow: { card: 'var(--shadow)', lift: 'var(--lift)' },
    },
  },
  plugins: [],
}
