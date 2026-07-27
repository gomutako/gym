import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
// Stessa fonte di verità dei colori usata da tailwind.config.js: il theme_color
// del manifest e il meta theme-color devono coincidere col brand, altrimenti la
// barra del browser e la schermata di avvio della PWA restano di un altro colore.
import { brand, surface } from './src/lib/palette.js';

// Letto con readFileSync e non con `import ... with { type: 'json' }`: in Node 22
// gli import JSON sono ancora sperimentali e stampano un warning a ogni build.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// Timestamp della migrazione più recente presente nel repo, iniettato nel bundle.
// Serve al badge diagnostico per confrontarlo con ciò che è davvero applicato sul
// database: è l'unico modo per rendere visibile il disallineamento fra codice e
// schema, che altrimenti si manifesta come un dato che "non si salva" senza che
// nessuno segnali un errore.
const migrationsDir = new URL('../supabase/migrations/', import.meta.url);
const expectedMigration = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => f.slice(0, 14))
  .filter((v) => /^\d{14}$/.test(v))
  .sort()
  .at(-1) ?? null;

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate', // aggiorna il service worker in automatico
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'Pallade',
        short_name: 'Pallade',
        description: 'Gestione palestra: schede, prenotazioni, allenamenti',
        lang: 'it',
        theme_color: brand[600],
        background_color: surface.light,
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
  // Versione dell'app leggibile a runtime: serve al badge diagnostico per
  // confrontarla con quella dichiarata dal backend. Presa dal package.json,
  // così resta allineata da sola a ogni release.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __DB_MIGRATION__: JSON.stringify(expectedMigration),
  },
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
