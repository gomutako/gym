// =====================================================
// Configurazione risolta a RUNTIME (Supabase + backend).
//
// L'app iOS è un bundle statico: le VITE_* sono cotte nel build, quindi lo
// stesso binario non può distinguere simulatore da device a build-time.
// Soluzione: il bundle contiene due terne di variabili e all'avvio si sceglie.
//
//   simulatore iOS -> terna VITE_*_SIM  (Supabase + backend in locale)
//   device / web   -> terna VITE_*      (Supabase Cloud + backend EC2)
//
// La terna senza suffisso resta il default, così `npm run dev:fe` nel browser
// e il build web per l'EC2 si comportano esattamente come prima.
// =====================================================
import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';

const DEFAULT_CONFIG = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL,
};

const SIM_CONFIG = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL_SIM,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY_SIM,
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL_SIM,
};

const isComplete = (config) =>
  Boolean(config.supabaseUrl && config.supabaseAnonKey && config.apiBaseUrl);

let resolved = null;

// `isVirtual` è true sul simulatore iOS (il plugin nativo lo deriva da
// targetEnvironment(simulator)). In caso di errore si assume device: un device
// che parte puntando a 127.0.0.1 è inutilizzabile, mentre un simulatore che
// parte sul cloud funziona comunque.
async function isSimulator() {
  if (Capacitor.getPlatform() !== 'ios') return false;
  try {
    const { isVirtual } = await Device.getInfo();
    return isVirtual === true;
  } catch (err) {
    console.warn('[config] rilevamento simulatore fallito, assumo device:', err);
    return false;
  }
}

/**
 * Risolve la configurazione da usare. Idempotente: va chiamata una volta in
 * main.js prima di creare il client Supabase e di montare l'app.
 */
export async function initRuntimeConfig() {
  if (resolved) return resolved;

  const simulator = await isSimulator();
  const useSim = simulator && isComplete(SIM_CONFIG);

  if (simulator && !useSim) {
    console.warn(
      '[config] simulatore rilevato ma terna VITE_*_SIM incompleta: uso la configurazione di default'
    );
  }

  const config = useSim ? SIM_CONFIG : DEFAULT_CONFIG;

  if (!isComplete(config)) {
    throw new Error(
      'Variabili mancanti: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY e VITE_API_BASE_URL (vedi frontend/.env)'
    );
  }

  resolved = { ...config, isSimulator: simulator, source: useSim ? 'sim' : 'default' };
  console.info(
    `[config] ambiente: ${resolved.source} — Supabase ${resolved.supabaseUrl}, API ${resolved.apiBaseUrl}`
  );
  return resolved;
}

/** Configurazione risolta. Da chiamare solo dopo initRuntimeConfig(). */
export function getRuntimeConfig() {
  if (!resolved) {
    throw new Error('initRuntimeConfig() non è stata ancora eseguita (vedi main.js)');
  }
  return resolved;
}
