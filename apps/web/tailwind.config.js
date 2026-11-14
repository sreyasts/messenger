/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        oled: '#000000',
        surface: {
          elevated: '#121212',
          header: '#1A1A1A',
          subtle: '#242424',
          bubbleIncoming: '#1E1E1E',
        },
        borderDark: '#2A2A2A',
        textDark: {
          primary: '#FFFFFF',
          secondary: '#A0A0A0',
          muted: '#666666',
        },
        accent: {
          violet: '#E1306C',
          ocean: '#0084FF',
          emerald: '#10B981',
          crimson: '#EF4444',
          monochrome: '#E5E5E5',
        }
      },
      backgroundImage: {
        'gradient-violet-pink': 'linear-gradient(135deg, #8A2387, #E94057, #F27121)',
        'gradient-ocean-blue': 'linear-gradient(135deg, #00C6FF, #0072FF)',
        'gradient-emerald': 'linear-gradient(135deg, #11998E, #38EF7D)',
        'gradient-crimson': 'linear-gradient(135deg, #FF416C, #FF4B2B)',
        'gradient-monochrome': 'linear-gradient(135deg, #434343, #1A1A1A)',
      },
      keyframes: {
        'pop-in': {
          '0%': { transform: 'scale(0.8)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        }
      },
      animation: {
        'pop-in': 'pop-in 0.15s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards',
        'fade-in': 'fade-in 0.2s ease-out forwards',
        'slide-up': 'slide-up 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      }
    },
  },
  plugins: [],
};
