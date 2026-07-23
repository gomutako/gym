// =====================================================
// Client Supabase lato FRONTEND.
// Usa la ANON key: sicura nel browser perché ogni query è
// filtrata dalla Row Level Security del database.
// Gestisce la sessione di autenticazione (login/logout/refresh).
// =====================================================
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Variabili mancanti: VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (vedi frontend/.env)'
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true, // mantiene il login tra i refresh (localStorage)
    autoRefreshToken: true, // rinnova il token in automatico
  },
});
