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

export async function requestAuth() {
  if (!native) return { granted: false };
  return HealthKitLive.requestAuth();
}

export async function start() {
  if (!native) return;
  await HealthKitLive.start();
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
