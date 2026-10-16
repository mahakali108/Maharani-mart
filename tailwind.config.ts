import type { Config } from 'tailwindcss';
import registry from './design/tokens.json';

const families = registry.families as Record<string, { tokens: Record<string, string> }>;

function familyScale(name: string): Record<string, string> {
  const tokens = families[name]?.tokens ?? {};
  return Object.fromEntries(
    Object.keys(tokens).map((shade) => [shade, `rgb(var(--palette-${name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}-${shade}-rgb) / <alpha-value>)`]),
  );
}

const violet = familyScale('violet');
const lavender = familyScale('lavender');
const navy = familyScale('navy');
const slate = familyScale('slate');
const ivory = familyScale('ivory');
const mint = familyScale('mint');
const sky = familyScale('sky');
const peach = familyScale('peach');
const amber = familyScale('amber');
const stone = familyScale('stone');
const pastelPink = familyScale('pastelPink');
const semantic = (name: string) => `rgb(var(--color-${name}-rgb) / <alpha-value>)`;

const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Compatibility aliases all resolve to the canonical documented token registry.
        primary: violet,
        action: violet,
        violet,
        lavender,
        mint,
        emerald: mint,
        green: mint,
        sky,
        blue: sky,
        peach,
        amber,
        gold: amber,
        blush: pastelPink,
        pastelPink,
        ivory: { ...ivory, DEFAULT: 'var(--palette-ivory-100)' },
        slate,
        ink: navy,
        navy,
        stone,
        success: mint,
        info: sky,
        warning: amber,
        error: {
          50: semantic('status-error-surface'),
          100: 'var(--palette-lavender-100)',
          200: semantic('status-error-border'),
          300: 'var(--palette-lavender-300)',
          400: 'var(--palette-navy-500)',
          500: 'var(--palette-navy-600)',
          600: 'var(--palette-navy-700)',
          700: semantic('status-error-text'),
          800: 'var(--palette-navy-900)',
          900: 'var(--palette-navy-950)',
        },
        // Controls and surfaces with meaning use explicit semantic aliases.
        semantic: {
          action: semantic('action-primary'),
          'on-action': semantic('action-on-primary'),
          'page': semantic('surface-page'),
          'card': semantic('surface-card'),
          'text': semantic('text-primary'),
          'text-secondary': semantic('text-secondary'),
          'error': semantic('status-error-text'),
          'error-surface': semantic('status-error-surface'),
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
      },
      boxShadow: {
        premium: '0 12px 32px -14px rgba(23, 35, 63, 0.16)',
        card: '0 1px 2px rgba(23, 35, 63, 0.05), 0 2px 8px -4px rgba(23, 35, 63, 0.08)',
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
