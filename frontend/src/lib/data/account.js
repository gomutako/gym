// =====================================================
// Livello dati — cancellazione del proprio account.
//
// Come admin.js, non passa da PostgREST: eliminare una riga di `auth.users`
// richiede la service_role key, che vive solo nella Edge Function.
// L'id dell'utente NON viene passato: lo ricava la funzione dal JWT, così
// nessuno può cancellare l'account di qualcun altro.
// =====================================================
import { db } from './client.js';

/**
 * Elimina definitivamente l'account di chi è connesso, insieme a profilo,
 * schede, prenotazioni, allenamenti, abbonamenti e immagini del profilo.
 * Dopo la chiamata la sessione non è più valida: il chiamante deve fare logout.
 */
export async function deleteOwnAccount() {
  const { data, error } = await db().functions.invoke('delete-account', {
    body: {},
  });

  if (error) {
    // Stesso motivo spiegato in admin.js: FunctionsHttpError espone solo un
    // messaggio generico, la ragione vera sta nel corpo della risposta.
    let detail = null;
    try {
      detail = (await error.context?.json())?.error;
    } catch { /* risposta non JSON: si usa il messaggio generico */ }
    throw new Error(detail || error.message || "Impossibile eliminare l'account");
  }

  return data;
}
