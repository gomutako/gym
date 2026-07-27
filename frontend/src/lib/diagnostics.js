// =====================================================
// Raccolta dati per il badge diagnostico della dashboard admin.
// Nessuna UI: solo sonde e normalizzazione del risultato.
//
// Criterio di scelta delle sonde: NON "quali servizi usiamo", ma **quali guasti
// passerebbero inosservati**. Cloudflare, per dire, non si sonda dal web — se
// fosse giù l'app non si sarebbe caricata e il badge non esisterebbe.
//
// Le sonde partono dal CLIENT di proposito: il caso da diagnosticare è "questa
// copia dell'app non raggiunge il servizio", non "il servizio è su" in astratto.
//
// STORIA: qui c'era una sonda del backend Fastify che confrontava la sua versione
// con quella dell'app. Eliminato il backend quella classe di guasti è sparita, ma
// il rischio equivalente si è spostato sullo SCHEMA: se il codice va in produzione
// prima della migrazione, PostgREST scarta le colonne che non esistono, risponde
// 2xx e il dato non viene salvato. Lo sorveglia probeSchema().
// =====================================================
import { supabase } from './supabase';
import { getRuntimeConfig } from './runtime-config';

export const SLOW_MS = 1500;
export const TIMEOUT_MS = 5000;

/** Host leggibile a partire da un URL completo (per non stampare l'URL intero). */
function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url || '—';
  }
}

/** fetch con timeout, per non lasciare il badge appeso su una rete che non risponde. */
async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Supabase: una query reale invece di un ping, così attraversa rete, chiave anon
 * e RLS — le tre cose che possono davvero rompersi. Un ping HTTP direbbe soltanto
 * che il server è vivo.
 */
async function probeSupabase() {
  const { supabaseUrl } = getRuntimeConfig();
  const url = hostOf(supabaseUrl);
  const startedAt = performance.now();
  try {
    const { error } = await supabase.from('exercises').select('id').limit(1);
    const latencyMs = Math.round(performance.now() - startedAt);
    return { url, ok: !error, latencyMs, error: error ? error.message : null };
  } catch (e) {
    return { url, ok: false, latencyMs: Math.round(performance.now() - startedAt), error: e.message };
  }
}

/**
 * Allineamento fra schema e codice.
 *
 * `expected` è la migrazione più recente presente nel repo al momento della build
 * (iniettata da vite.config.js); `applied` è quella davvero applicata al database.
 * I due casi di disallineamento non sono equivalenti:
 *  - database INDIETRO rispetto al codice → il caso pericoloso: il client scrive
 *    colonne inesistenti e i dati si perdono in silenzio;
 *  - database AVANTI → di norma innocuo (una migrazione applicata prima del
 *    rilascio), ma vale la pena vederlo.
 */
async function probeSchema() {
  const expected = typeof __DB_MIGRATION__ === 'string' ? __DB_MIGRATION__ : null;
  try {
    const { data, error } = await supabase.rpc('latest_migration');
    if (error) return { expected, applied: null, ok: false, error: error.message };

    const applied = data ?? null;
    if (!applied || !expected) {
      return { expected, applied, ok: false, error: 'versione non determinabile' };
    }
    if (applied === expected) return { expected, applied, ok: true, error: null };

    return {
      expected,
      applied,
      ok: false,
      error: applied < expected
        ? 'database indietro rispetto al codice: migrazioni da applicare'
        : 'database più avanti del codice: app da aggiornare',
    };
  } catch (e) {
    return { expected, applied: null, ok: false, error: e.message };
  }
}

/**
 * Edge Function `admin-users`: è l'unico codice privilegiato dell'app e serve al
 * cambio email. Se non fosse deployata, l'admin lo scoprirebbe solo provandoci.
 * Si usa una preflight OPTIONS: non richiede autenticazione, non modifica nulla e
 * risponde solo se la funzione esiste davvero.
 */
async function probeEdgeFunction() {
  const { supabaseUrl } = getRuntimeConfig();
  const url = `${supabaseUrl}/functions/v1/admin-users`;
  const startedAt = performance.now();
  try {
    const res = await fetchWithTimeout(url, { method: 'OPTIONS' });
    const latencyMs = Math.round(performance.now() - startedAt);
    return {
      name: 'admin-users',
      ok: res.ok,
      latencyMs,
      error: res.ok ? null : `non raggiungibile (HTTP ${res.status})`,
    };
  } catch (e) {
    return {
      name: 'admin-users',
      ok: false,
      latencyMs: Math.round(performance.now() - startedAt),
      error: e.name === 'AbortError' ? `nessuna risposta entro ${TIMEOUT_MS / 1000} s` : e.message,
    };
  }
}

/**
 * Storage: se le policy del bucket si rompessero, il catalogo perderebbe tutte le
 * immagini senza altri sintomi — l'app continuerebbe a funzionare mostrando
 * riquadri vuoti.
 */
async function probeStorage() {
  const startedAt = performance.now();
  try {
    // Si parte da un `image_path` reale del catalogo invece di elencare il
    // bucket: è il percorso che le viste usano davvero, quindi la sonda risponde
    // alla domanda giusta ("le immagini degli esercizi si vedono?") anziché a
    // "il bucket contiene qualcosa". Elencare la radice, fra l'altro,
    // restituisce per prima una cartella, il cui URL pubblico non è un file.
    const { data, error } = await supabase
      .from('exercises')
      .select('image_path')
      .not('image_path', 'is', null)
      .limit(1)
      .maybeSingle();
    if (error) {
      return { ok: false, latencyMs: Math.round(performance.now() - startedAt), error: error.message };
    }
    if (!data?.image_path) {
      return { ok: false, latencyMs: Math.round(performance.now() - startedAt), error: 'nessun esercizio con immagine' };
    }

    const { data: pub } = supabase.storage.from('exercise-images').getPublicUrl(data.image_path);
    const res = await fetchWithTimeout(pub.publicUrl, { method: 'HEAD' });
    const latencyMs = Math.round(performance.now() - startedAt);
    return {
      ok: res.ok,
      latencyMs,
      error: res.ok ? null : `immagini non servite (HTTP ${res.status})`,
    };
  } catch (e) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - startedAt),
      error: e.name === 'AbortError' ? `nessuna risposta entro ${TIMEOUT_MS / 1000} s` : e.message,
    };
  }
}

/** Ambiente e sessione: nessuna chiamata di rete, i dati sono già in memoria. */
async function readEnvironmentAndSession(role) {
  const { source, isSimulator } = getRuntimeConfig();
  let expiresAt = null;
  try {
    const { data } = await supabase.auth.getSession();
    expiresAt = data.session?.expires_at ? new Date(data.session.expires_at * 1000) : null;
  } catch { /* sessione non leggibile: il badge resta utilizzabile */ }

  return {
    environment: { source, isSimulator, appVersion: __APP_VERSION__ },
    session: { role: role ?? null, expiresAt },
  };
}

/**
 * Esegue le sonde in parallelo. `role` arriva dallo store di auth: il modulo non
 * dipende da Pinia, così resta testabile e riusabile.
 */
export async function collect(role) {
  const [supabaseStatus, schema, edgeFunction, storage, rest] = await Promise.all([
    probeSupabase(),
    probeSchema(),
    probeEdgeFunction(),
    probeStorage(),
    readEnvironmentAndSession(role),
  ]);
  return { supabase: supabaseStatus, schema, edgeFunction, storage, ...rest };
}

/**
 * Tre livelli, perché due non distinguono il caso interessante.
 *
 * `down` è riservato a ciò che rende l'app inutilizzabile: senza Supabase non si
 * fa nulla. Le altre sonde producono `warn`: uno schema disallineato o le immagini
 * che non si caricano non fermano l'app — la fanno sbagliare in silenzio, ed è
 * esattamente per quello che il badge esiste.
 */
export function overallStatus(d) {
  if (!d.supabase.ok) return 'down';
  const slow = d.supabase.latencyMs > SLOW_MS;
  if (!d.schema.ok || !d.edgeFunction.ok || !d.storage.ok || slow) return 'warn';
  return 'ok';
}
