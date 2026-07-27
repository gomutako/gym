import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // ⚠️ Il bundle id NON è più modificabile dopo la prima pubblicazione su App
  // Store: cambiarlo dopo significherebbe pubblicare un'app diversa, con scheda
  // e utenti da rifare. Fissato prima di qualsiasi rilascio.
  appId: 'it.pallade.app',
  appName: 'Pallade',
  webDir: 'dist',
  server: {
    // Build bundlata: nessun URL remoto. iOS scheme di default.
    iosScheme: 'capacitor',
  },
};

export default config;
