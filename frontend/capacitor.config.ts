import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'local.gym.app',
  appName: 'Gym',
  webDir: 'dist',
  server: {
    // Build bundlata: nessun URL remoto. iOS scheme di default.
    iosScheme: 'capacitor',
  },
};

export default config;
