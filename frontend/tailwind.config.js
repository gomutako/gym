/** @type {import('tailwindcss').Config} */
import { brand } from './src/lib/palette.js';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Rosa antico: la scala sta in src/lib/palette.js perché la usa anche il
        // codice che tinge la tab bar nativa. DEFAULT è il passo 600, così le
        // classi `brand` già scritte nelle viste continuano a valere.
        brand: {
          ...brand,
          DEFAULT: brand[600],
          dark: brand[700],
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
