/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './frontend/index.html',
    './frontend/src/**/*.{js,ts,jsx,tsx}',
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}'
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        mono: ['Space Mono', 'monospace'],
        sans: ['Manrope', 'sans-serif'],
        display: ['Fraunces', 'serif'],
      },
      colors: {
        apex: {
          bg:            '#080C14',
          bg2:           '#0D1322',
          surface:       '#11192C',
          card:          'rgba(17, 25, 44, 0.72)',
          'card-hover':  'rgba(23, 34, 59, 0.85)',
          border:        'rgba(255, 255, 255, 0.08)',
          'border-bright': 'rgba(255, 255, 255, 0.16)',
          gold:          '#F59E0B',
          accent:        '#10B981',
          orange:        '#F97316',
          green:         '#10B981',
          red:           '#EF4444',
          cyan:          '#06B6D4',
          text:          '#F8FAFC',
          muted:         '#94A3B8',
          subtle:        '#64748B',
          navy:          '#0A1224',
        }
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow':       'glow 2s ease-in-out infinite alternate',
        'ticker':     'ticker 30s linear infinite',
      },
      keyframes: {
        glow: {
          '0%':   { boxShadow: '0 0 5px rgba(245,158,11,0.3)' },
          '100%': { boxShadow: '0 0 20px rgba(245,158,11,0.6), 0 0 40px rgba(245,158,11,0.2)' }
        },
        ticker: {
          '0%':   { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' }
        }
      }
    }
  },
  plugins: [],
};
