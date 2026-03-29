/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#B87333',
          dark:    '#8B5A1F',
          light:   '#E8A653',
          soft:    'rgba(184,115,51,0.12)',
        },
        sidebar: {
          DEFAULT: '#141210',
          border:  'rgba(255,255,255,0.06)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI Variable Text', 'Aptos', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'card':  '0 1px 3px rgba(0,0,0,0.07), 0 4px 12px rgba(0,0,0,0.04)',
        'panel': '0 2px 8px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        'lift':  '0 8px 24px rgba(0,0,0,0.10), 0 2px 6px rgba(0,0,0,0.06)',
      },
      borderRadius: {
        'xl2': '14px',
      },
    },
  },
  plugins: [],
}
