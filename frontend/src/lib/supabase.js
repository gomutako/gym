// =====================================================
// Client Supabase lato FRONTEND.
// Usa la ANON key: sicura nel browser perché ogni query è
// filtrata dalla Row Level Security del database.
// Gestisce la sessione di autenticazione (login/logout/refresh).
//
// L'URL e la key arrivano da runtime-config (locale nel simulatore iOS,
// cloud su device e web), quindi il client viene creato da initSupabase()
// e non a import-time. I moduli che importano `supabase` lo usano sempre
// dentro funzioni, e i live binding ES propagano l'assegnazione.
// =====================================================
import { createClient } from '@supabase/supabase-js';
import { getRuntimeConfig } from './runtime-config';

export let supabase = null;

/**
 * Crea il client con la configurazione risolta. Idempotente.
 * Va chiamata in main.js dopo initRuntimeConfig() e prima del mount.
 */
export function initSupabase() {
  if (supabase) return supabase;

  const { supabaseUrl, supabaseAnonKey } = getRuntimeConfig();

  // Lo storageKey di default di supabase-js include l'host del progetto
  // (sb-<host>-auth-token), quindi le sessioni locale e cloud sono già separate.
  supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true, // mantiene il login tra i refresh (localStorage)
      autoRefreshToken: true, // rinnova il token in automatico
    },
  });

  return supabase;
}
