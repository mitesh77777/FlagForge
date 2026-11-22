import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#07080b',
          900: '#0b0d12',
          850: '#0f1218',
          800: '#13161e',
          700: '#1c2029',
          600: '#2a2f3b',
400: '#5b6272',
        },
        accent: {
          DEFAULT: '#34d399',
          dim: '#10b981',
        },
      },
      fontFamily: {
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'monospace',
        ],
      },
      keyframes: {
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'pulse-soft': 'pulse-soft 1.6s ease-in-out infinite',
        'fade-in': 'fade-in 220ms ease-out',
      },
    },
  },
  plugins: [],
};

export default config;