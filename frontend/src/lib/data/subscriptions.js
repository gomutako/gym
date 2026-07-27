// =====================================================
// Livello dati — periodi di abbonamento.
// Sostituisce /api/subscriptions (GET /member/:id, POST, DELETE).
//
// Autorizzazione dalla RLS: `subscriptions_select` dà al member i propri periodi
// e a trainer/admin tutti; `subscriptions_write` riserva la scrittura all'admin.
// Il controllo "un member non legge i periodi di un altro", che il backend
// faceva a mano, ora è la policy stessa: una lettura non autorizzata torna
// vuota invece di 403.
//
// `profiles.subscription_end_date` NON si scrive da qui: è denormalizzata come
// max(end_date) e la mantiene il trigger sync_subscription_end.
// =====================================================
import { db, unwrap, PG } from './client.js';

/** Periodi di un member, dal più recente. */
export async function listSubscriptions(memberId) {
  return unwrap(
    await db()
      .from('subscriptions')
      .select('*')
      .eq('member_id', memberId)
      .order('end_date', { ascending: false })
  );
}

/** Crea un periodo (solo admin). Date in formato 'YYYY-MM-DD'. */
export async function createSubscription({ member_id, start_date, end_date }) {
  if (!member_id || !start_date || !end_date) {
    throw new Error('Cliente, data di inizio e data di fine sono obbligatorie');
  }
  // Controllo anche lato client per dare l'errore prima del giro di rete;
  // la garanzia vera è il constraint subscriptions_dates_ck sul database.
  if (end_date < start_date) {
    throw new Error('La data di fine precede quella di inizio');
  }
  return unwrap(
    await db()
      .from('subscriptions')
      .insert({ member_id, start_date, end_date })
      .select()
      .single(),
    {
      [PG.CHECK_VIOLATION]: 'La data di fine precede quella di inizio',
      [PG.FOREIGN_KEY]: 'Il cliente indicato non esiste',
      [PG.NO_SINGLE_ROW]: 'Non hai i permessi per creare un abbonamento',
      [PG.NOT_AUTHORIZED]: 'Solo un amministratore può gestire gli abbonamenti',
    }
  );
}

/** Elimina un periodo (solo admin). */
export async function deleteSubscription(id) {
  const rows = unwrap(await db().from('subscriptions').delete().eq('id', id).select('id'));
  if (!rows?.length) {
    throw new Error('Periodo non trovato (o non hai i permessi per eliminarlo)');
  }
  return true;
}
