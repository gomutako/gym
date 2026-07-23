/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Palette brand palestra (personalizzabile)
        brand: {
          DEFAULT: '#4f46e5', // indigo-600
          dark: '#4338ca',
        },
      },
      // Spazio per la bottom navigation + safe-area dei device con notch
      spacing: {
        'safe-bottom': 'env(safe-area-inset-bottom)',
      },
    },
  },
  plugins: [],
};
