/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  // Disable dark mode completely — we always use light
  darkMode: false,
  theme: {
    extend: {
      fontFamily: {
        mono: ['Space Mono', 'monospace'],
        sans: ['Manrope', 'sans-serif'],
        display: ['Fraunces', 'serif'],
      },
      colors: {
        apex: {
          bg:        '#EEF1F6',
          bg2:       '#E4E9F2',
          surface:   '#FFFFFF',
          card:      '#FFF8F2',
          border:    '#DCDFE6',
          accent:    '#0E6B4F',
          orange:    '#C9A24B',
          gold:      '#C9A24B',
          green:     '#12805F',
          red:       '#B0263B',
          yellow:    '#C9A24B',
          muted:     '#5B6472',
          text:      '#14171F',
          cream:     '#F6F4EE',
          darkgreen: '#0A4636',
          navy:      '#16305C',
        }
      },
      backgroundColor: {
        'apex-bg':      '#EEF1F6',
        'apex-surface': '#FFFFFF',
        'apex-card':    '#FFF8F2',
      },
      textColor: {
        'apex-text':  '#14171F',
        'apex-muted': '#5B6472',
      },
      backdropBlur: {
        xs: '2px',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow':       'glow 2s ease-in-out infinite alternate',
        'ticker':     'ticker 30s linear infinite',
      },
      keyframes: {
        glow: {
          '0%':   { boxShadow: '0 0 5px rgba(201,162,75,0.3)' },
          '100%': { boxShadow: '0 0 20px rgba(201,162,75,0.6), 0 0 40px rgba(201,162,75,0.2)' }
        },
        ticker: {
          '0%':   { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' }
        }
      }
    }
  },
  plugins: []
};
