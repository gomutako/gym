// =====================================================
// Configurazione risolta a RUNTIME (Supabase + backend).
//
// L'app iOS è un bundle statico: le VITE_* sono cotte nel build, quindi lo
// stesso binario non può distinguere simulatore da device a build-time.
// Soluzione: il bundle contiene due COPPIE di variabili e all'avvio si sceglie.
//
//   simulatore iOS -> coppia VITE_*_SIM  (Supabase locale)
//   device / web   -> coppia VITE_*      (Supabase Cloud)
//
// La coppia senza suffisso resta il default, così `npm run dev:fe` nel browser
// si comporta come il build di produzione.
//
// Non c'è più un `apiBaseUrl`: eliminato il backend, l'unico servizio da
// configurare è Supabase.
// =====================================================
import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';

const DEFAULT_CONFIG = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
};

const SIM_CONFIG = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL_SIM,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY_SIM,
};

const isComplete = (config) => Boolean(config.supabaseUrl && config.supabaseAnonKey);

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
      '[config] simulatore rilevato ma coppia VITE_*_SIM incompleta: uso la configurazione di default'
    );
  }

  const config = useSim ? SIM_CONFIG : DEFAULT_CONFIG;

  if (!isComplete(config)) {
    throw new Error(
      'Variabili mancanti: VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (vedi frontend/.env)'
    );
  }

  resolved = { ...config, isSimulator: simulator, source: useSim ? 'sim' : 'default' };
  console.info(`[config] ambiente: ${resolved.source} — Supabase ${resolved.supabaseUrl}`);
  return resolved;
}

/** Configurazione risolta. Da chiamare solo dopo initRuntimeConfig(). */
export function getRuntimeConfig() {
  if (!resolved) {
    throw new Error('initRuntimeConfig() non è stata ancora eseguita (vedi main.js)');
  }
  return resolved;
}
