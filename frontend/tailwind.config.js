export default {
  darkMode: 'class',
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
        sans: ['Manrope', '"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: {
          DEFAULT: '#14212e',
          soft: '#56646f',
          muted: '#8fa1b3',
        },
        meridian: {
          teal: '#0f8f87',
          'teal-dark': '#0b6f6a',
          'teal-deep': '#074f4b',
          'teal-light': '#dff3ea',
          dark: '#12202e',
          'dark-card': '#1a2b3c',
          'dark-hover': '#1c2d3e',
          border: '#dbe3ea',
          bg: '#eef2f5',
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
