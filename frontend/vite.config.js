import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate', // aggiorna il service worker in automatico
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'Gym Manager',
        short_name: 'Gym',
        description: 'Gestione palestra: schede, prenotazioni, allenamenti',
        lang: 'it',
        theme_color: '#4f46e5',
        background_color: '#f9fafb',
        display: 'standalone', // avvio a schermo intero, senza barra del browser
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // SPA: qualsiasi navigazione ricade su index.html (routing lato client)
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
      },
    }),
  ],
  resolve: {
    alias: {
      // Alias "@" -> cartella src, per import puliti (es. "@/stores/auth")
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true, // accessibile da dispositivi in LAN per test mobile reale
  },
});
