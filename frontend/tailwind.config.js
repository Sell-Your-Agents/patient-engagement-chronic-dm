export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      screens: {
        // Enough vertical room to show the full Quick Call card in the sidebar
        tall: { raw: '(min-height: 860px)' },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: {
          DEFAULT: '#1f2a37',
          soft: '#4b5563',
          muted: '#8a94a6',
        },
        brand: {
          50: '#fff4ea',
          100: '#ffe4cc',
          400: '#ff9a3c',
          500: '#ff7a1a',
          600: '#f26a0a',
        },
      },
    },
  },
  plugins: [],
}
