// =====================================================
// Client HTTP verso il backend Fastify.
// Allega automaticamente il JWT Supabase dell'utente loggato.
// =====================================================
import { supabase } from './supabase';
import { getRuntimeConfig } from './runtime-config';

// Esportata perché anche lib/diagnostics.js deve autenticare le proprie
// chiamate, ma senza passare da apiFetch: gli serve lo status code della
// risposta, che apiFetch perde sollevando un'eccezione.
export async function authHeader() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch(path, options = {}) {
  const headers = {
    // Content-Type solo se c'è un body: Fastify rifiuta (400) le richieste
    // con "application/json" ma corpo vuoto (es. DELETE senza payload).
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(await authHeader()),
    ...(options.headers || {}),
  };

  const res = await fetch(getRuntimeConfig().apiBaseUrl + path, { ...options, headers });

  if (!res.ok) {
    // Prova a estrarre il messaggio d'errore JSON dal backend
    let message = `Errore ${res.status}`;
    try {
      const body = await res.json();
      message = body.error || message;
    } catch { /* body non-JSON */ }
    throw new Error(message);
  }

  if (res.status === 204) return null; // No Content
  return res.json();
}

export const api = {
  get: (path) => apiFetch(path),
  post: (path, body) => apiFetch(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: (path, body) => apiFetch(path, { method: 'PATCH', body: JSON.stringify(body) }),
  del: (path) => apiFetch(path, { method: 'DELETE' }),
};
