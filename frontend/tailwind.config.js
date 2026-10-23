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
        // -- Bhishma redesign foundation (additive; existing families untouched) --
        // Display: Alike - self-hosted (src/assets/fonts), carved editorial serif.
        alike: ['Alike', 'Georgia', '"Times New Roman"', 'serif'],
        // Body: IBM Plex Sans - self-hosted variable font, the workhorse.
        plex: ['"IBM Plex Sans"', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
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
        },
        // -- Bhishma war-room palette (mirrors --bh-* custom properties in src/index.css) --
        bh: {
          ink: {
            950: '#070605',
            900: '#0D0B09',
            850: '#12100D',
            800: '#171410',
            750: '#1D1915',
            700: '#26211B',
          },
          border:        '#2E2820',
          'border-strong': '#453B2C',
          'border-faint':  '#211D17',
          bone: {
            100: '#F2EAD8',
            300: '#D9CFB8',
            500: '#A89B82',
            600: '#7E7360',
          },
          gold: {
            DEFAULT: '#C6A15B',
            bright:  '#E6CC8A',
            deep:    '#8C713C',
            dim:     '#3A2F1B',
          },
          ember: {
            DEFAULT: '#E4571D',
            bright:  '#FF7A33',
            deep:    '#9A3412',
            dim:     '#3D1E0E',
          },
          up:   '#34C26E',
          down: '#E5484D',
          warn: '#F2B33D',
          info: '#4C9AFF',
        }
      },
      borderRadius: {
        bh: '0.625rem',
        'bh-lg': '0.875rem',
      },
      boxShadow: {
        'bh-panel': '0 1px 0 0 rgba(242,234,216,0.03) inset, 0 12px 32px -16px rgba(0,0,0,0.65)',
        'bh-gold-glow': '0 0 0 1px rgba(198,161,91,0.45), 0 0 18px -2px rgba(198,161,91,0.35)',
      },
      animation: {
        // -- Bhishma motion primitives (keyframes below; CSS twins in index.css) --
        'bh-page-in':    'bh-page-in 0.45s cubic-bezier(0.22, 1, 0.36, 1) both',
        'bh-fade-rise':  'bh-fade-rise 0.55s cubic-bezier(0.22, 1, 0.36, 1) both',
        'bh-shimmer':    'bh-shimmer 2.4s linear infinite',
        'bh-pulse-live': 'bh-pulse-live 2s ease-in-out infinite',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow':       'glow 2s ease-in-out infinite alternate',
        'ticker':     'ticker 30s linear infinite',
      },
      keyframes: {
        'bh-page-in': {
          '0%':   { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        'bh-fade-rise': {
          '0%':   { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        'bh-shimmer': {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' }
        },
        'bh-pulse-live': {
          '0%, 100%': { opacity: '1', boxShadow: '0 0 0 0 rgba(52, 194, 110, 0.45)' },
          '50%':      { opacity: '0.75', boxShadow: '0 0 0 5px rgba(52, 194, 110, 0)' }
        },
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
