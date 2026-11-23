import type { Config } from 'tailwindcss';

/**
 * FlagForge design tokens.
 *
 * A pure-black developer-tool aesthetic: hairline borders, no drop shadows, no
 * decorative gradients. Accents are limited to three semantic signals — emerald
 * for healthy/on, amber for partial or degraded, red for kill-switched/failed —
 * and ride Tailwind's built-in `emerald-500` (#10B981), `amber-500` (#F59E0B)
 * and `red-500` (#EF4444) so the palette stays in one place.
 */
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        canvas: '#000000',
        panel: '#0A0A0A',
        card: '#111111',
        line: {
          DEFAULT: '#1F1F1F',
          strong: '#333333',
        },
        ink: {
          DEFAULT: '#FAFAFA',
          muted: '#888888',
          faint: '#4D4D4D',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      keyframes: {
        'pulse-dot': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.4', transform: 'scale(0.85)' },
        },
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        flash: {
          '0%': { backgroundColor: 'rgba(16,185,129,0.14)' },
          '100%': { backgroundColor: 'transparent' },
        },
      },
      animation: {
        'pulse-dot': 'pulse-dot 1.8s ease-in-out infinite',
        'fade-up': 'fade-up 260ms cubic-bezier(0.22, 1, 0.36, 1)',
        flash: 'flash 900ms ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
