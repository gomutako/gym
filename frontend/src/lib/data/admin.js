// =====================================================
// Livello dati — operazioni amministrative che richiedono privilegi di servizio.
//
// È l'UNICO modulo che non parla con PostgREST: passa dalla Edge Function
// `admin-users`, perché cambiare l'email vive in `auth.users` e richiede la
// service_role key, che non può stare nel bundle.
//
// Tutto il resto della gestione utenti (ruolo, nome, abbonamenti) è normale
// scrittura su `profiles` governata dalla RLS — vedi profiles.js.
// =====================================================
import { db } from './client.js';

/**
 * Cambia l'email di un utente (solo admin). Imposta l'indirizzo senza inviare
 * una mail di conferma: è una modifica dell'anagrafica lato gestione.
 * `profiles.email` viene allineata dal trigger sync_profile_email.
 */
export async function updateUserEmail(userId, email) {
  const { data, error } = await db().functions.invoke('admin-users', {
    body: { user_id: userId, email },
  });

  if (error) {
    // La Edge Function risponde con { error: "<messaggio in italiano>" }: il
    // FunctionsHttpError di supabase-js però espone solo un messaggio generico,
    // quindi il corpo va letto per mostrare la ragione vera.
    let detail = null;
    try {
      detail = (await error.context?.json())?.error;
    } catch { /* risposta non JSON: si usa il messaggio generico */ }
    throw new Error(detail || error.message || 'Impossibile cambiare l\'email');
  }

  return data;
}
