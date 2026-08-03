// =====================================================
// Consuma i messaggi accumulati dal Watch e li riversa su Supabase.
//
// Perché esiste come modulo a sé: la materializzazione può avvenire in due
// posti diversi (la lista allenamenti o la sessione aperta) e in momenti
// imprevedibili — l'app iPhone può essere stata chiusa per tutto
// l'allenamento. La logica è una sola e non appartiene a nessuna vista.
// =====================================================
import * as watch from '@/lib/watch';
import { mergeSetDone } from '@/lib/session-merge';
import { db } from '@/lib/data/client';
import {
  createSessionFromSnapshot, getSession, updateSession,
} from '@/lib/data/sessions';

// --- Coda di ritentativo, persistita fuori dal buffer nativo -----------
//
// `watch.getState()` SVUOTA il buffer nativo non appena risponde: da quel
// momento i messaggi esistono SOLO nell'array locale di questa funzione. Se
// `createSessionFromSnapshot` fallisce (un errore di rete transitorio,
// proprio nel momento — la riconnessione dopo l'armadietto — in cui è più
// probabile), senza una coda propria quel messaggio sparirebbe e basta: i
// `set_done`/`session_closed` seguenti per la stessa sessione non
// troverebbero mai la riga e verrebbero anch'essi scartati. Questa coda
// tiene da parte ciò che non si è riusciti ad applicare, per riprovarlo al
// prossimo drain — che sia la prossima apertura di TrainingView o il
// prossimo giro dopo un errore di rete risolto.
//
// Persistita in `localStorage` (lo stesso storage che supabase-js usa già
// per `persistSession`): questo modulo gira SEMPRE dentro la WebView di
// Capacitor, quindi sopravvive anche se iOS termina il processo fra un
// drain e l'altro — lo scenario esatto di questo bug. Il fallback in
// memoria serve solo agli script e2e sotto Node (nessun DOM): lì la
// persistenza vale per la durata del processo, che è tutto ciò che serve a
// provare che un secondo drain nello stesso script ritrova i messaggi non
// applicati.
const memoryFallback = new Map();
function storageGet(key) {
  if (typeof localStorage !== 'undefined') return localStorage.getItem(key);
  return memoryFallback.get(key) ?? null;
}
function storageSet(key, value) {
  if (typeof localStorage !== 'undefined') { localStorage.setItem(key, value); return; }
  memoryFallback.set(key, value);
}
function storageRemove(key) {
  if (typeof localStorage !== 'undefined') { localStorage.removeItem(key); return; }
  memoryFallback.delete(key);
}

const RETRY_KEY_PREFIX = 'gym:watch-drain-retry:';
// Un messaggio che fallisce SEMPRE (forma corrotta, chiave che non esisterà
// mai) non deve restare in coda per sempre: dopo questi tentativi si scarta,
// con un log — è la garanzia che una coda non svuotabile non blocchi quelle
// dopo di lei all'infinito.
const MAX_RETRY_ATTEMPTS = 5;

function loadRetryQueue(memberId) {
  try {
    const raw = storageGet(RETRY_KEY_PREFIX + memberId);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRetryQueue(memberId, queue) {
  try {
    if (queue.length) storageSet(RETRY_KEY_PREFIX + memberId, JSON.stringify(queue));
    else storageRemove(RETRY_KEY_PREFIX + memberId);
  } catch {
    // Storage pieno o non disponibile: non c'è un posto migliore dove tenere
    // questi messaggi. Meglio far proseguire l'allenamento (i messaggi
    // restano solo nella variabile locale, persi a fine funzione) che
    // bloccarlo per un problema di storage locale.
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Traduce la chiave che il Watch usa per una sessione nell'id della riga.
 *
 * La chiave ha due origini: per una sessione nata al polso è il
 * `client_session_id` generato lì; per una sessione nata sull'iPhone e poi
 * adottata dal Watch è l'**id della riga**, perché quando l'iPhone l'ha aperta
 * nessun `client_session_id` esisteva. Senza questa risoluzione le serie
 * chiuse al polso su una sessione adottata verrebbero scartate in silenzio.
 */
async function resolveSessionId(key, memberId, cache) {
  if (cache[key] !== undefined) return cache[key];

  // `key` finisce interpolata in un filtro PostgREST `.or()`. Oggi arriva
  // SEMPRE da un client_session_id generato con crypto.randomUUID() (Watch) o
  // da un id di riga Postgres (telefono) — entrambi UUID — ma senza questo
  // controllo un valore che smettesse di esserlo passerebbe non validato
  // dentro la stringa del filtro invece di essere trattato come "non
  // risolvibile". Anche una chiave scartata qui passa dal normale percorso
  // di ritentativo/scarto di drainWatchMessages, non da un errore separato.
  if (typeof key !== 'string' || !UUID_RE.test(key)) {
    cache[key] = null;
    return null;
  }

  const { data } = await db()
    .from('workout_sessions')
    .select('id')
    .eq('member_id', memberId)
    .or(`id.eq.${key},client_session_id.eq.${key}`)
    .limit(1)
    .maybeSingle();

  cache[key] = data?.id ?? null;
  return cache[key];
}

/**
 * Svuota il buffer nativo e applica tutto in ordine.
 *
 * ⚠️ `watch.getState()` SVUOTA il buffer: se questa funzione fallisce a metà,
 * i messaggi già estratti sono persi DAL BUFFER NATIVO. Per questo la
 * sessione viene creata al primo evento utile e ogni `set_done` viene
 * persistito subito, invece di accumulare e salvare alla fine — e per
 * questo ciò che non si riesce ad applicare finisce nella coda di
 * ritentativo sopra, non nel nulla: un `session_started` fallito
 * lascerebbe altrimenti orfani, e quindi scartati in silenzio, tutti i
 * `set_done`/`session_closed` della stessa sessione che lo seguono.
 *
 * @returns {{ sessionId: string|null }} la sessione toccata, se ce n'è una.
 */
export async function drainWatchMessages(memberId) {
  if (!watch.isSupported()) return { sessionId: null };

  // I ritentativi di un drain precedente vengono PRIMA dei messaggi appena
  // arrivati: sono i più vecchi, ed è cosí che l'ordine resta quello reale
  // il più possibile.
  const retryQueue = loadRetryQueue(memberId);
  const state = await watch.getState();
  const pending = [...retryQueue, ...(state.pending || [])];
  if (!pending.length) return { sessionId: null };

  const cache = {};   // chiave del Watch -> id Supabase (null = introvabile)
  const unresolved = [];
  let touched = null;

  function retry(msg) {
    const attempts = (msg._attempts || 0) + 1;
    if (attempts >= MAX_RETRY_ATTEMPTS) {
      console.error(
        `[watch-session] messaggio scartato dopo ${attempts} tentativi: ` +
        `${msg.type} (client_session_id=${msg.client_session_id})`
      );
      return;
    }
    unresolved.push({ ...msg, _attempts: attempts });
  }

  for (const msg of pending) {
    try {
      if (msg.type === 'session_started') {
        const session = await createSessionFromSnapshot({
          client_session_id: msg.client_session_id,
          workout_id: msg.workout_id,
          workout_title: msg.workout_title,
          day_index: msg.day_index,
          day_name: msg.day_name,
          started_at: msg.started_at,
          exercises_log: msg.exercises_log,
        }, memberId);
        cache[msg.client_session_id] = session.id;
        touched = session.id;
      } else if (msg.type === 'set_done') {
        const id = await resolveSessionId(msg.client_session_id, memberId, cache);
        if (!id) { retry(msg); continue; }
        const session = await getSession(id);
        const { log, changed } = mergeSetDone(session.exercises_log, {
          uid: msg.uid, reps: msg.reps, load: msg.load,
          ...(msg.incline !== undefined ? { incline: msg.incline } : {}),
          done_at: msg.done_at,
        });
        if (changed) await updateSession(id, { exercises_log: log });
        touched = id;
      } else if (msg.type === 'session_closed') {
        const id = await resolveSessionId(msg.client_session_id, memberId, cache);
        if (!id) { retry(msg); continue; }
        await updateSession(id, { completed_at: msg.completed_at });
        touched = id;
      }
    } catch {
      // Un messaggio che non si riesce ad applicare non deve bloccare gli
      // altri: perdere una serie è meglio che perdere l'allenamento. Ma non
      // va perso e basta: finisce in coda per il prossimo drain.
      //
      // Se è il `session_started` a fallire, la chiave si marca come "non
      // risolvibile in questo giro" nella cache: i `set_done`/`session_closed`
      // della STESSA sessione più avanti in questo stesso batch non sprecano
      // una query per scoprirlo da soli, e finiscono in coda con lei invece
      // di sembrare orfani di una sessione che in realtà esiste solo non
      // ancora creata.
      if (msg.type === 'session_started' && msg.client_session_id) {
        cache[msg.client_session_id] = null;
      }
      retry(msg);
    }
  }

  saveRetryQueue(memberId, unresolved);
  return { sessionId: touched };
}
