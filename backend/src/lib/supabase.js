// =====================================================
// Client Supabase lato BACKEND.
// Usa la SERVICE_ROLE key: bypassa la RLS, quindi va usata
// SOLO qui sul server e MAI esposta al browser.
// I controlli di autorizzazione li facciamo noi nelle rotte (Fase 3).
// =====================================================
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'Variabili mancanti: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (vedi backend/.env)'
  );
}

// Client admin: privilegi pieni, nessuna sessione persistita.
export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Crea un client "utente" dato un JWT: le query rispettano la RLS
// come l'utente autenticato. Utile per far valere i permessi reali.
export function supabaseForToken(accessToken) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
