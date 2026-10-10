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
        // Maharani wine — primary brand colour (muted wine-red, replaces the
        // former bright red). 600 is the brand core used for the logo mark,
        // theme colour and primary surfaces.
        primary: {
          50: '#fbf4f6',
          100: '#f7e7ec',
          200: '#efcdd8',
          300: '#e4a5b7',
          400: '#d4758f',
          500: '#b5476a',
          600: '#8f1d40',
          700: '#7a1936',
          800: '#65172d',
          900: '#4f1424',
          950: '#2c0a14',
        },
        // Primary ACTION colour (Add to cart, checkout, primary buttons). The
        // marketplace blue has been retired: CTAs now use the wine family so the
        // whole app reads as one premium identity. Class names are unchanged.
        action: {
          50: '#fbf4f6',
          100: '#f7e7ec',
          200: '#efcdd8',
          300: '#e4a5b7',
          400: '#c9617f',
          500: '#a4325a',
          600: '#8f1d40',
          700: '#771a37',
          800: '#60152d',
          900: '#4d1325',
        },
        // Restrained gold — premium accents, badges, offer highlights (never
        // used for body text on white below 700).
        gold: {
          50: '#fbf7ec',
          100: '#f5eccd',
          200: '#ead79f',
          300: '#dcbd6b',
          400: '#c9a24c',
          500: '#b08634',
          600: '#94702a',
          700: '#7a5b24',
          800: '#654a22',
          900: '#543d1f',
        },
        // Blush — soft pink surfaces for category tiles and highlights.
        blush: {
          50: '#fdf8f8',
          100: '#fbeff1',
          200: '#f5dfe4',
          300: '#edc9d1',
          400: '#e0a7b4',
        },
        // Ivory — app background and calm section surfaces.
        ivory: {
          DEFAULT: '#fbf8f3',
          50: '#fdfbf7',
          100: '#fbf8f3',
          200: '#f4eee3',
        },
        // Warm neutrals replace the cool grey Tailwind slate scale so text,
        // borders and surfaces sit harmoniously with the wine/ivory palette.
        // Body text (600–950) keeps WCAG AA contrast on white and ivory.
        slate: {
          50: '#fcf9f8',
          100: '#f5efee',
          200: '#e8dedd',
          300: '#cfc1c2',
          400: '#958486',
          500: '#76666a',
          600: '#5f5155',
          700: '#4a3e42',
          800: '#33292c',
          900: '#231b1e',
          950: '#150f11',
        },
        // Near-black — used for text, sidebars, premium dark surfaces (warm).
        ink: {
          50: '#fbf8f5',
          100: '#eee8e4',
          200: '#dcd3cf',
          300: '#b7aca8',
          400: '#8a817d',
          500: '#6d6664',
          600: '#585150',
          700: '#453f3d',
          800: '#2f2a29',
          900: '#1e1a19',
          950: '#0f0c0c',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
      },
      boxShadow: {
        premium: '0 12px 32px -14px rgba(79, 20, 36, 0.22)',
        card: '0 1px 2px rgba(79, 20, 36, 0.06), 0 2px 8px -4px rgba(79, 20, 36, 0.08)',
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
