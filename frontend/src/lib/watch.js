// =====================================================
// Wrapper platform-agnostic per il collegamento con l'Apple Watch.
// UNICA sorgente che la UI importa. Su browser/PWA: no-op, supported:false.
// Il plugin nativo `WatchLink` è in ios/App/App/WatchLinkPlugin.swift.
// =====================================================
import { Capacitor, registerPlugin } from '@capacitor/core';

const native = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
const WatchLink = registerPlugin('WatchLink');

/**
 * Rimuove ricorsivamente le chiavi con valore `null`/`undefined` da un
 * payload, applicata qui — UNICO punto di passaggio verso il nativo — invece
 * che in ognuno dei chiamanti.
 *
 * PERCHÉ: `WCSession.updateApplicationContext` (e `sendMessage`,
 * `transferUserInfo`, i `replyHandler`) accetta solo tipi property-list —
 * NSString, NSNumber, NSDate, NSData, NSArray, NSDictionary. Un `null`
 * JavaScript attraversa il ponte Capacitor come `NSNull`, che non è uno di
 * questi tipi: un payload che lo contiene anche una sola volta, in un punto
 * qualsiasi (anche annidato), viene scartato per INTERO e in silenzio — non
 * un crash, non un errore, perché gli handler d'errore di WatchConnectivity
 * sono vuoti apposta per traffico best-effort. Sul device si è visto così:
 * `[DIAG] pushCatalog ERRORE: Payload contains unsupported type.`. `reps` e
 * `load` sono `null` per qualunque esercizio senza storico o non ancora
 * compilato — il caso normale, non l'eccezione — quindi senza questa pulizia
 * `catalog`/`set_done`/`session_started` non arriverebbero MAI per la
 * maggior parte degli allenamenti.
 *
 * La regola è quindi: quando un valore manca, la chiave si OMETTE, non si
 * manda `null`. Applicata qui e non nei singoli costruttori di payload
 * (`watch-catalog.js`, `SessionView.vue`) perché è questo il solo posto che
 * tutti loro attraversano prima del nativo — un futuro chiamante la eredita
 * gratis, invece di doversene ricordare da sé. NON reintrodurre `?? null`
 * "per simmetria" nei payload a monte.
 *
 * Esportata (non solo uso interno) perché è anche ciò che uno script e2e
 * verifica direttamente sul payload di `pushCatalog`, senza dover passare
 * da `native`/Capacitor per arrivarci.
 */
export function stripNullish(value) {
  if (Array.isArray(value)) return value.map(stripNullish);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      if (v === null || v === undefined) continue;
      out[key] = stripNullish(v);
    }
    return out;
  }
  return value;
}

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
  return WatchLink.send({ payload: stripNullish(payload), queued });
}

// Cache: solo l'ultimo stato conta, nessuna coda da smaltire.
export async function setContext(payload) {
  if (!native) return;
  await WatchLink.setContext({ payload: stripNullish(payload) });
}

// Copia nativa dello stato della sessione in corso, per rispondere al Watch
// mentre la WebView dorme (`state_request` risponde il plugin, non il JS).
// Passare null/undefined la cancella (sessione chiusa o completata).
//
// stripNullish anche qui: questo payload finisce scritto su disco come JSON
// (dove `null` sarebbe innocuo) ma da lì rientra in un `replyHandler` di
// WatchConnectivity quando il Watch chiede lo stato — vedi il commento su
// `currentSessionState()` in WatchLinkPlugin.swift, lato nativo, che applica
// la stessa pulizia in lettura come seconda linea di difesa.
export async function setSessionState(payload) {
  if (!native) return;
  await WatchLink.setSessionState(payload ? { payload: stripNullish(payload) } : {});
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
