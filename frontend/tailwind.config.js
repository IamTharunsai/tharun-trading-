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
          bg:        '#FAF6F1',
          surface:   '#FFFFFF',
          card:      '#FFFBF7',
          border:    '#E8D5C4',
          accent:    '#FF8C42',
          orange:    '#FF8C42',
          green:     '#2D8A4A',
          red:       '#DC2626',
          yellow:    '#F5A623',
          muted:     '#8B6F47',
          text:      '#2C1810',
          cream:     '#FFF5E6',
          darkgreen: '#1B5E3F',
        }
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow':   'glow 2s ease-in-out infinite alternate',
        'ticker': 'ticker 30s linear infinite',
      },
      keyframes: {
        glow: {
          '0%':   { boxShadow: '0 0 5px #FF8C4240' },
          '100%': { boxShadow: '0 0 20px #FF8C4280, 0 0 40px #FF8C4220' }
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
