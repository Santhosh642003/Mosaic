import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'ms-deep':   '#010409',
        'ms-base':   '#0D1117',
        'ms-surface':'#161B22',
        'ms-raised': '#1C2128',
        'ms-border': '#30363D',
        'ms-subtle': '#21262D',
        'ms-fg':     '#E6EDF3',
        'ms-fg2':    '#7D8590',
        'ms-fg3':    '#484F58',
        'ms-blue':   '#4F8EF7',
        'ms-bdim':   '#2D4A77',
        'ms-green':  '#3FB950',
        'ms-purple': '#A371F7',
        'ms-amber':  '#D29922',
        'ms-red':    '#F85149',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Menlo', 'monospace'],
      },
      keyframes: {
        'ms-rise': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'ms-pop': {
          '0%':   { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'ms-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.4' },
        },
        'ms-spin': {
          from: { transform: 'rotate(0deg)' },
          to:   { transform: 'rotate(360deg)' },
        },
        'ms-dots': {
          '0%, 80%, 100%': { transform: 'scale(0)' },
          '40%':           { transform: 'scale(1)' },
        },
        'ms-gradient': {
          '0%':   { backgroundPosition: '0% 50%' },
          '100%': { backgroundPosition: '200% 50%' },
        },
        'ms-shake': {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%':      { transform: 'translateX(-4px)' },
          '40%':      { transform: 'translateX(4px)' },
          '60%':      { transform: 'translateX(-4px)' },
          '80%':      { transform: 'translateX(4px)' },
        },
      },
      animation: {
        'ms-rise':     'ms-rise 0.15s ease forwards',
        'ms-pop':      'ms-pop 0.2s ease forwards',
        'ms-pulse':    'ms-pulse 1.5s ease-in-out infinite',
        'ms-spin':     'ms-spin 0.8s linear infinite',
        'ms-gradient': 'ms-gradient 3s linear infinite',
        'ms-shake':    'ms-shake 0.4s ease',
      },
    },
  },
  plugins: [],
} satisfies Config;
