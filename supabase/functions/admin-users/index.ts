// =====================================================
// Edge Function `admin-users` — operazioni su auth.users riservate all'admin.
//
// Perché esiste: cambiare l'email di un utente richiede la Auth Admin API, che
// vuole la **service_role key**. Quella chiave non può stare nel bundle del
// frontend (bypassa la RLS: chi ce l'ha legge e scrive tutto). Questa funzione è
// l'unico pezzo di codice dell'app che ne ha bisogno — tutto il resto passa da
// PostgREST con la anon key e la RLS.
//
// Deploy:  npx supabase functions deploy admin-users
// Secret:  SUPABASE_SERVICE_ROLE_KEY e SUPABASE_URL sono iniettati da Supabase.
//
// ⚠️ L'autorizzazione va verificata QUI: la funzione gira con privilegi pieni,
// quindi non può fidarsi di chi la chiama. Si controlla il JWT del chiamante e
// si rilegge il suo ruolo dal database — non da un campo del token, che il
// client potrebbe non avere aggiornato.
// =====================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Origini ammesse: il dominio web e la WebView dell'app iOS (Capacitor), più
// localhost per lo sviluppo. Configurabile con il secret ALLOWED_ORIGINS
// (lista separata da virgole) senza ridistribuire la funzione.
const DEFAULT_ORIGINS = [
  'https://pallade.it',
  'capacitor://localhost',
  'http://localhost:5173',
];

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') ?? DEFAULT_ORIGINS.join(','))
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Metodo non consentito' }, 405, origin);
  }

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Token di autenticazione mancante' }, 401, origin);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  // 1. Chi chiama?
  const { data: caller, error: authError } = await admin.auth.getUser(token);
  if (authError || !caller?.user) {
    return json({ error: 'Token non valido o scaduto' }, 401, origin);
  }

  // 2. È admin? Il ruolo si rilegge dal database, non dal token.
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role')
    .eq('id', caller.user.id)
    .single();
  if (profileError || profile?.role !== 'admin') {
    return json({ error: 'Accesso negato: richiesto ruolo admin' }, 403, origin);
  }

  // 3. Payload
  let body: { user_id?: string; email?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Corpo della richiesta non valido' }, 400, origin);
  }

  const userId = body.user_id?.trim();
  const email = body.email?.trim();
  if (!userId) return json({ error: 'user_id mancante' }, 400, origin);
  if (!email || !EMAIL_RE.test(email)) {
    return json({ error: 'Indirizzo email non valido' }, 400, origin);
  }

  // 4. Conflitto: si controlla PRIMA di chiamare l'Auth API.
  // Non è un'ottimizzazione: su email duplicata GoTrue risponde con
  // `AuthRetryableFetchError`, status 500 e message "{}" — nessuna informazione
  // utilizzabile per distinguere il conflitto da un guasto. Il controllo si fa
  // su `profiles.email`, che il trigger sync_profile_email tiene allineata a
  // auth.users, quindi è una fonte affidabile e costa una query indicizzata.
  const { data: clash } = await admin
    .from('profiles')
    .select('id')
    .eq('email', email)
    .neq('id', userId)
    .maybeSingle();
  if (clash) {
    return json({ error: 'Questa email è già usata da un altro utente' }, 409, origin);
  }

  // 5. Cambio email. `email_confirm: true` la imposta subito senza mail di
  // conferma: è una modifica fatta dall'admin sull'anagrafica, non un cambio
  // richiesto dall'utente. Il trigger sync_profile_email allinea profiles.email.
  const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(
    userId,
    { email, email_confirm: true },
  );
  if (updateError) {
    // GoTrue può restituire un messaggio vuoto o "{}": mostrarlo all'utente non
    // servirebbe a niente, quindi si degrada a un testo comprensibile.
    const raw = (updateError.message ?? '').trim();
    const useful = raw && raw !== '{}' && raw !== '[object Object]';
    return json(
      {
        error: useful
          ? raw
          : "Impossibile aggiornare l'email: il servizio di autenticazione ha restituito un errore",
      },
      400,
      origin,
    );
  }

  return json({ id: updated.user.id, email: updated.user.email }, 200, origin);
});
