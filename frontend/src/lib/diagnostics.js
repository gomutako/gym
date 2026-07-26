// =====================================================
// Raccolta dati per il badge diagnostico della dashboard admin.
// Nessuna UI: solo sonde e normalizzazione del risultato.
//
// Le sonde di raggiungibilità partono dal CLIENT di proposito: è il punto di
// vista che conta, perché il caso da diagnosticare è "questa copia dell'app non
// raggiunge il servizio", non "il servizio è su" in astratto.
// =====================================================
import { supabase } from './supabase';
import { getRuntimeConfig } from './runtime-config';
import { authHeader } from './api';

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
 * Sonda del backend: /api/health per la raggiungibilità, poi
 * /api/admin/diagnostics per versione, stato DB e uptime.
 *
 * Il 404 sulla seconda NON è un guasto: significa che il backend è precedente
 * alla versione che ha introdotto la rotta — cioè esattamente il caso che
 * questo badge esiste per rendere visibile.
 */
async function probeBackend() {
  const { apiBaseUrl } = getRuntimeConfig();
  const url = hostOf(apiBaseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = performance.now();

  try {
    const res = await fetch(`${apiBaseUrl}/api/health`, { signal: controller.signal });
    const latencyMs = Math.round(performance.now() - startedAt);
    if (!res.ok) {
      return { url, ok: false, latencyMs, version: null, uptimeS: null, error: `HTTP ${res.status}` };
    }

    // Raggiungibile: ora chiediamo chi è.
    let version = null;
    let uptimeS = null;
    let error = null;
    try {
      const d = await fetch(`${apiBaseUrl}/api/admin/diagnostics`, {
        headers: await authHeader(),
        signal: controller.signal,
      });
      if (d.status === 404) {
        error = "backend più vecchio dell'app";
      } else if (!d.ok) {
        error = `diagnostica non disponibile (HTTP ${d.status})`;
      } else {
        const body = await d.json();
        version = body.version ?? null;
        uptimeS = body.uptime_s ?? null;
        if (body.database && body.database.ok === false) {
          error = `database non raggiungibile dal backend${body.database.error ? `: ${body.database.error}` : ''}`;
        }
      }
    } catch (e) {
      error = e.name === 'AbortError' ? 'timeout sulla diagnostica' : e.message;
    }

    return { url, ok: true, latencyMs, version, uptimeS, error };
  } catch (e) {
    const latencyMs = Math.round(performance.now() - startedAt);
    const error = e.name === 'AbortError' ? `nessuna risposta entro ${TIMEOUT_MS / 1000} s` : e.message;
    return { url, ok: false, latencyMs, version: null, uptimeS: null, error };
  } finally {
    clearTimeout(timer);
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
  const [backend, supabaseStatus, rest] = await Promise.all([
    probeBackend(),
    probeSupabase(),
    readEnvironmentAndSession(role),
  ]);
  return { backend, supabase: supabaseStatus, ...rest };
}

/**
 * Tre livelli, perché due non distinguono il caso interessante: un servizio
 * raggiungibile ma sbagliato (versione diversa) è il guasto silenzioso.
 */
export function overallStatus(d) {
  if (!d.backend.ok || !d.supabase.ok) return 'down';
  const versionMismatch =
    !d.backend.version || d.backend.version !== d.environment.appVersion;
  const slow = d.backend.latencyMs > SLOW_MS || d.supabase.latencyMs > SLOW_MS;
  if (versionMismatch || slow || d.backend.error) return 'warn';
  return 'ok';
}
