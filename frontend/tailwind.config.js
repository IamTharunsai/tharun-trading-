/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['Space Mono', 'monospace'],
        sans: ['Syne', 'sans-serif'],
      },
      colors: {
        apex: {
          bg:       '#080C14',
          surface:  '#0D1421',
          card:     '#111827',
          border:   '#1E2D45',
          accent:   '#00D4FF',
          green:    '#00FF88',
          red:      '#FF3B5C',
          yellow:   '#FFD700',
          muted:    '#4B6280',
          text:     '#E2EAF4',
        }
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
        'ticker': 'ticker 30s linear infinite',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px #00D4FF40' },
          '100%': { boxShadow: '0 0 20px #00D4FF80, 0 0 40px #00D4FF20' }
        },
        ticker: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' }
        }
      }
    }
  },
  plugins: []
};
