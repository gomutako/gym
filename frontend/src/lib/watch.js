// =====================================================
// Wrapper platform-agnostic per il collegamento con l'Apple Watch.
// UNICA sorgente che la UI importa. Su browser/PWA: no-op, supported:false.
// Il plugin nativo `WatchLink` è in ios/App/App/WatchLinkPlugin.swift.
// =====================================================
import { Capacitor, registerPlugin } from '@capacitor/core';

const native = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
const WatchLink = registerPlugin('WatchLink');

export function isSupported() {
  return native;
}

// Solo lo stato del collegamento, senza toccare il buffer. È questa che va
// usata per decidere "c'è un Watch?".
export async function getLink() {
  if (!native) {
    return { supported: false, paired: false, installed: false, reachable: false };
  }
  return WatchLink.getLink();
}

/**
 * Stato del collegamento e messaggi arrivati mentre la WebView dormiva.
 * ⚠️ Chiamarla SVUOTA il buffer nativo: chi la chiama deve consumare
 * `pending`, altrimenti quei messaggi sono persi. Per il solo stato del
 * collegamento usare `getLink()`.
 */
export async function getState() {
  if (!native) {
    return { supported: false, paired: false, installed: false, reachable: false, pending: [] };
  }
  return WatchLink.getState();
}

// queued:true accoda (non va perso, sopravvive alla app chiusa);
// queued:false è best effort e viene scartato se il Watch non è raggiungibile.
export async function send(payload, { queued = true } = {}) {
  if (!native) return { skipped: true };
  return WatchLink.send({ payload, queued });
}

// Cache: solo l'ultimo stato conta, nessuna coda da smaltire.
export async function setContext(payload) {
  if (!native) return;
  await WatchLink.setContext({ payload });
}

// cb riceve il dizionario inviato dal Watch. Ritorna funzione di unsubscribe.
export function onMessage(cb) {
  if (!native) return () => {};
  const h = WatchLink.addListener('watchMessage', (e) => cb(e));
  return () => Promise.resolve(h).then((x) => x.remove?.());
}

export function onReachability(cb) {
  if (!native) return () => {};
  const h = WatchLink.addListener('watchReachability', (e) => cb(e.reachable));
  return () => Promise.resolve(h).then((x) => x.remove?.());
}
