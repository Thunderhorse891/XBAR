import type { Config } from 'tailwindcss';

// XBAR aerospace-graphite palette. Every color in the system maps to one of
// the values supplied in the design brief — no off-palette colors.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#010204', // deep black
          inset: '#080B10',
          graphite: '#11151B',
        },
        shell: '#03070D', // sidebar/shell black
        abyss: '#05080D', // dark app background
        void: '#03060A', // deeper background
        canvas: '#EEF5FB', // bright silver
        surface: '#EDF5FF', // primary light surface
        steel: {
          DEFAULT: '#AEB9C5',
          strong: '#B5C7DC',
          muted: '#8AA0B8',
        },
        gunmetal: '#303842',
        panel: {
          DEFAULT: 'rgba(10, 16, 26, 0.92)',
          strong: 'rgba(14, 23, 36, 0.96)',
          elevated: 'rgba(17, 28, 44, 0.88)',
        },
        metal: 'rgba(206, 221, 234, 0.24)',
        blueline: 'rgba(45, 140, 255, 0.42)',
        accent: {
          DEFAULT: '#18A8FF', // electric blue
          strong: '#2D8CFF', // command blue
          glow: 'rgba(24, 168, 255, 0.16)',
        },
        // Per design direction: no green. Verified/success states render in
        // XBAR blues; only warning amber and blocked rose remain as status hues.
        warning: '#D6A74D',
        danger: '#D8666C',
        heading: '#F2F7FF',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
      },
      letterSpacing: {
        micro: '0.14em',
      },
      boxShadow: {
        command: '0 18px 40px -24px rgba(3, 7, 13, 0.55)',
        lift: '0 10px 30px -18px rgba(17, 21, 27, 0.35)',
      },
      keyframes: {
        'scan-line': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(250%)' },
        },
      },
      animation: {
        'scan-line': 'scan-line 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
