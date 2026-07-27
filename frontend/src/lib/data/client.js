// =====================================================
// Registro del client Supabase per il livello dati.
//
// Perché esiste, invece di importare `supabase` da lib/supabase.js:
// quel modulo dipende da lib/runtime-config.js, che legge `import.meta.env` e
// quindi funziona SOLO sotto Vite. Tenendo qui un registro minimo, i moduli di
// lib/data/ restano importabili da node — così gli script e2e usa-e-getta
// esercitano il codice VERO dell'app invece di riscrivere le stesse query
// (che è il modo classico di far passare i test mentre l'app è rotta).
//
// initSupabase() registra il client all'avvio; negli script si chiama
// setDataClient() con un client creato a mano.
// =====================================================

let client = null;

/** Registra il client da usare per tutte le query del livello dati. */
export function setDataClient(supabaseClient) {
  client = supabaseClient;
}

/** Client corrente. Lancia se non è stato registrato (errore di bootstrap). */
export function db() {
  if (!client) {
    throw new Error(
      'Client Supabase non registrato: setDataClient() va chiamata prima (lo fa initSupabase() in lib/supabase.js)'
    );
  }
  return client;
}

/**
 * Normalizza l'esito di una query PostgREST: restituisce i dati o lancia un
 * Error con un messaggio leggibile.
 *
 * Assume il ruolo che aveva il backend nel tradurre gli errori: senza questo,
 * ogni chiamante dovrebbe controllare `error` a mano e le viste mostrerebbero
 * `undefined`. I trigger del database sollevano già messaggi in italiano, quindi
 * quelli si propagano così come sono; `messagesByCode` serve per i codici
 * Postgres generici, che altrimenti arriverebbero all'utente in inglese e con
 * il nome del vincolo dentro.
 *
 * @param {object} result esito di una query supabase-js
 * @param {Record<string,string>} messagesByCode es. { '23505': 'Nome già usato' }
 */
// Testo che Postgres usa quando la RLS respinge un INSERT. Va distinto dai
// nostri guard trigger, che usano lo STESSO codice 42501 ma con messaggi già
// scritti in italiano e più precisi: quelli non si devono mai sovrascrivere.
const RLS_DENIED = /violates row-level security policy/i;

export function unwrap({ data, error }, messagesByCode = {}) {
  if (error) {
    let message = error.message || 'Errore inatteso';

    if (error.code === PG.NOT_AUTHORIZED && RLS_DENIED.test(message)) {
      // INSERT respinto dalla policy: il testo Postgres è inglese e nomina la
      // tabella, inutile per l'utente.
      message = messagesByCode[PG.NOT_AUTHORIZED] || 'Non hai i permessi per questa operazione';
    } else if (messagesByCode[error.code] && error.code !== PG.NOT_AUTHORIZED) {
      message = messagesByCode[error.code];
    }

    const err = new Error(message);
    err.code = error.code;
    err.details = error.details;
    throw err;
  }
  return data;
}

// Codici Postgres/PostgREST ricorrenti, per non ripeterli in ogni modulo.
export const PG = {
  UNIQUE_VIOLATION: '23505',   // vincolo unique
  FOREIGN_KEY: '23503',        // riferimento inesistente
  CHECK_VIOLATION: '23514',    // check constraint
  NOT_AUTHORIZED: '42501',     // sollevato dai guard trigger
  RAISE_EXCEPTION: 'P0001',    // raise exception esplicita (es. capacità corso)
  INVALID_VALUE: '22023',      // forma JSON non valida
  NO_SINGLE_ROW: 'PGRST116',   // .single() con 0 righe: non trovato o RLS
};
