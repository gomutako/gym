// =====================================================
// Raccolta dati per il badge diagnostico della dashboard admin.
// Nessuna UI: solo sonde e normalizzazione del risultato.
//
// Le sonde partono dal CLIENT di proposito: è il punto di vista che conta,
// perché il caso da diagnosticare è "questa copia dell'app non raggiunge il
// servizio", non "il servizio è su" in astratto.
//
// STORIA: qui c'era anche una sonda del backend Fastify che confrontava la sua
// versione con quella dell'app. Serviva a rendere visibile uno skew che poteva
// far sparire i dati in silenzio (un backend vecchio scartava i campi che non
// conosceva). Eliminato il backend, quella classe di guasti non esiste più: resta
// un solo servizio da raggiungere, e lo schema del database è allineato dalle
// migration prima del deploy.
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

/**
 * Sonda di Supabase: una query reale invece di un ping, così attraversa rete,
 * chiave anon e RLS — le tre cose che possono davvero rompersi. Un ping HTTP
 * direbbe soltanto che il server è vivo.
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
  const [supabaseStatus, rest] = await Promise.all([
    probeSupabase(),
    readEnvironmentAndSession(role),
  ]);
  return { supabase: supabaseStatus, ...rest };
}

/**
 * Tre livelli. Con un solo servizio da sondare il "warn" resta utile per la
 * lentezza: un'app che risponde in 3 secondi non è rotta, ma non è sana.
 */
export function overallStatus(d) {
  if (!d.supabase.ok) return 'down';
  if (d.supabase.latencyMs > SLOW_MS) return 'warn';
  return 'ok';
}
