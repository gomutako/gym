// =====================================================
// Edge Function `delete-account` — l'utente cancella il PROPRIO account.
//
// Perché esiste: eliminare una riga di `auth.users` richiede la Auth Admin API
// e quindi la **service_role key**, che non può stare nel bundle del frontend.
// È obbligatoria per l'App Store: ogni app che permette di registrarsi deve
// permettere di cancellarsi da dentro l'app (linea guida 5.1.1(v)) — un modulo
// di richiesta o un indirizzo email non bastano.
//
// Deploy:  npx supabase functions deploy delete-account
// Secret:  SUPABASE_SERVICE_ROLE_KEY e SUPABASE_URL sono iniettati da Supabase.
//
// ⚠️ Si cancella SOLO sé stessi. L'id non arriva dal corpo della richiesta ma
// dal JWT verificato: un parametro `user_id` sarebbe una cancellazione di
// chiunque a disposizione di chiunque.
// =====================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';

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

const AVATAR_BUCKET = 'avatars';

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

  // 1. Chi chiama? È l'unico modo in cui questa funzione apprende quale account
  //    cancellare.
  const { data: caller, error: authError } = await admin.auth.getUser(token);
  if (authError || !caller?.user) {
    return json({ error: 'Token non valido o scaduto' }, 401, origin);
  }
  const userId = caller.user.id;

  // 2. L'ultimo admin non può cancellarsi: resterebbe una palestra senza nessuno
  //    in grado di gestire ruoli e abbonamenti, e non c'è modo di rimediare
  //    dall'app. Il ruolo si rilegge dal database, non dal token.
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();
  if (profileError) {
    return json({ error: 'Profilo non trovato' }, 404, origin);
  }
  if (profile.role === 'admin') {
    const { count, error: countError } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin');
    if (countError) {
      return json({ error: 'Verifica degli amministratori non riuscita' }, 500, origin);
    }
    if ((count ?? 0) <= 1) {
      return json(
        {
          error:
            "Sei l'unico amministratore: nomina un altro amministratore prima di eliminare il tuo account",
        },
        409,
        origin,
      );
    }
  }

  // 3. Storage: i file NON seguono le foreign key. Gli avatar stanno sotto la
  //    "cartella" <uid>/ (vedi lib/storage.js) e vanno rimossi a mano, altrimenti
  //    resterebbero immagini di una persona che ha chiesto di sparire.
  const { data: files, error: listError } = await admin.storage
    .from(AVATAR_BUCKET)
    .list(userId);
  if (!listError && files?.length) {
    await admin.storage
      .from(AVATAR_BUCKET)
      .remove(files.map((f) => `${userId}/${f.name}`));
  }

  // 4. Cancellazione dell'utente. Il resto cade da sé: `profiles` ha
  //    `on delete cascade` da auth.users, e schede, prenotazioni, sessioni e
  //    abbonamenti hanno `on delete cascade` da profiles. Ciò che l'utente ha
  //    creato come istruttore (corsi, schede altrui) ha invece
  //    `on delete set null`: resta alla palestra, senza più un autore.
  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) {
    const raw = (deleteError.message ?? '').trim();
    const useful = raw && raw !== '{}' && raw !== '[object Object]';
    return json(
      {
        error: useful
          ? raw
          : "Impossibile eliminare l'account: il servizio di autenticazione ha restituito un errore",
      },
      500,
      origin,
    );
  }

  return json({ deleted: true }, 200, origin);
});
