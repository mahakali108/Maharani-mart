import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Premium Red — primary brand color
        primary: {
          50: '#fdf2f3',
          100: '#fce4e6',
          200: '#f9ccd1',
          300: '#f4a3ac',
          400: '#ec6f7d',
          500: '#dd3d4f',
          600: '#c8102e', // brand core
          700: '#a80c26',
          800: '#8c0f24',
          900: '#771023',
          950: '#41040f',
        },
        // Near-black — used for text, sidebars, premium dark surfaces
        ink: {
          50: '#f6f6f6',
          100: '#e7e7e7',
          200: '#d1d1d1',
          300: '#b0b0b0',
          400: '#888888',
          500: '#6d6d6d',
          600: '#5d5d5d',
          700: '#4f4f4f',
          800: '#333333',
          900: '#1a1a1a',
          950: '#0b0b0b',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
      },
      boxShadow: {
        premium: '0 4px 24px -4px rgba(11, 11, 11, 0.12)',
        card: '0 1px 3px rgba(11, 11, 11, 0.08), 0 1px 2px rgba(11, 11, 11, 0.04)',
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.25rem',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
