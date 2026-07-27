// =====================================================
// Livello dati — prenotazioni ai corsi.
// Sostituisce /api/bookings (GET, GET /class/:id, POST, DELETE).
//
// La regola più importante non è più qui: la **capacità** del corso la impone il
// trigger `bookings_enforce_capacity`, che conta con un lock sulla riga del
// corso. Il backend invece contava e poi inseriva, senza lock: due richieste
// sull'ultimo posto passavano entrambe. Quindi questo modulo non conta nulla —
// prova a inserire e traduce l'errore.
//
// Chi vede cosa lo decide `bookings_select`: il member le proprie, il trainer
// quelle dei propri corsi, l'admin tutte.
// =====================================================
import { db, unwrap, PG } from './client.js';

/** Le proprie prenotazioni, con i dati del corso, dalla più recente. */
export async function listOwnBookings(memberId) {
  return unwrap(
    await db()
      .from('bookings')
      .select('id, created_at, classes(*)')
      .eq('member_id', memberId)
      .order('created_at', { ascending: false })
  );
}

/**
 * Partecipanti a un corso (trainer titolare o admin).
 * Il controllo "sei il trainer di questo corso", che il backend faceva
 * leggendo prima `classes.trainer_id`, ora è dentro `bookings_select`:
 * un trainer che chiede i partecipanti di un corso non suo ottiene 0 righe.
 */
export async function listClassParticipants(classId) {
  return unwrap(
    await db()
      .from('bookings')
      .select('id, created_at, profiles:member_id(id, full_name)')
      .eq('class_id', classId)
  );
}

/**
 * Prenota un corso per sé. `bookings_insert` impone member_id = auth.uid(),
 * quindi non si può prenotare a nome di altri nemmeno passando un id diverso.
 */
export async function bookClass(classId, memberId) {
  return unwrap(
    await db()
      .from('bookings')
      .insert({ class_id: classId, member_id: memberId })
      .select()
      .single(),
    {
      [PG.UNIQUE_VIOLATION]: 'Sei già prenotato a questo corso',
      [PG.FOREIGN_KEY]: 'Corso non trovato',
      [PG.NOT_AUTHORIZED]: 'Non puoi prenotare a nome di un altro utente',
      // il trigger di capacità solleva P0001 con messaggio 'Corso al completo',
      // che unwrap propaga già in italiano
    }
  );
}

/** Annulla una prenotazione (la propria, o qualsiasi se admin). */
export async function cancelBooking(bookingId) {
  const rows = unwrap(
    await db().from('bookings').delete().eq('id', bookingId).select('id')
  );
  if (!rows?.length) {
    throw new Error('Prenotazione non trovata (o non puoi annullarla)');
  }
  return true;
}
