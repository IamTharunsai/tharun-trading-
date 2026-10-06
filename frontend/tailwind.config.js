/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    '../frontend/src/**/*.{js,ts,jsx,tsx}'
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        apex: {
          bg:            '#F8FAFC',
          bg2:           '#FFFFFF',
          surface:       '#FFFFFF',
          'surface-2':   '#F1F5F9',
          surface2:      '#F1F5F9',
          card:          '#FFFFFF',
          'card-hover':  '#F1F5F9',
          border:        '#E2E8F0',
          'border-bright': '#CBD5E1',
          gold:          '#D97706',
          primary:       '#1E40AF',
          accent:        '#059669',
          orange:        '#EA580C',
          green:         '#059669',
          red:           '#DC2626',
          cyan:          '#0284C7',
          text:          '#0F172A',
          muted:         '#64748B',
          subtle:        '#94A3B8',
          navy:          '#0F172A',
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
