// =====================================================
// Wrapper platform-agnostic per HealthKit (solo iOS nativo via Capacitor).
// UNICA sorgente che la UI importa. Su browser/PWA: no-op, supported:false.
// Il plugin nativo `HealthKitLive` è definito in ios/App/App/HealthKitLivePlugin.swift.
// =====================================================
import { Capacitor, registerPlugin } from '@capacitor/core';

const native = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';

// registerPlugin è sicuro anche su web: ritorna un proxy che non useremo lì.
const HealthKitLive = registerPlugin('HealthKitLive');

export function isSupported() {
  return native;
}

// Ritorna { granted, available, error }. `error` non null spiega PERCHÉ i dati
// non arriveranno: senza questo la UI non distingue un permesso negato da un
// Watch che non sta trasmettendo.
export async function requestAuth() {
  if (!native) {
    return { granted: false, available: false, error: 'HealthKit richiede l\'app iOS nativa' };
  }
  return HealthKitLive.requestAuth();
}

// startISO: inizio della sessione. I campioni misurati prima non sono ancora arrivati
// dal Watch quando la schermata si apre, quindi ancorare a "adesso" li perderebbe.
export async function start(startISO) {
  if (!native) return;
  await HealthKitLive.start(startISO ? { start: startISO } : {});
}

export async function stop() {
  if (!native) return;
  await HealthKitLive.stop();
}

export async function summary(startISO, endISO) {
  if (!native) return { hr_avg: null, hr_max: null, active_kcal: null };
  return HealthKitLive.summary({ start: startISO, end: endISO });
}

// cb riceve { type, value, timestamp }. Ritorna funzione di unsubscribe.
export function onSample(cb) {
  if (!native) return () => {};
  const hHR = HealthKitLive.addListener('heartRate', (e) =>
    cb({ type: 'heartRate', value: e.value, timestamp: e.timestamp }));
  const hEN = HealthKitLive.addListener('activeEnergy', (e) =>
    cb({ type: 'activeEnergy', value: e.value, timestamp: e.timestamp }));
  return () => {
    // addListener ritorna una Promise<PluginListenerHandle> in Capacitor 6
    Promise.resolve(hHR).then((h) => h.remove?.());
    Promise.resolve(hEN).then((h) => h.remove?.());
  };
}
