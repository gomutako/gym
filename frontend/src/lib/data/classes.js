// =====================================================
// Livello dati — palinsesto corsi.
// Sostituisce le rotte backend /api/classes (GET, GET/:id, POST, PATCH, DELETE).
//
// Autorizzazione: la fa la RLS. `classes_select` apre la lettura a tutti gli
// autenticati, `classes_write` riserva scrittura e cancellazione all'admin.
// Un trainer che provasse a creare un corso otterrebbe 0 righe, non un 403:
// per questo create/update usano .single(), che trasforma il "nessuna riga"
// in un errore invece di restituire silenziosamente undefined.
// =====================================================
import { db, unwrap, PG } from './client.js';

const MESSAGES = {
  [PG.NO_SINGLE_ROW]: 'Corso non trovato (o non hai i permessi per modificarlo)',
  [PG.NOT_AUTHORIZED]: 'Solo un amministratore può gestire il palinsesto',
};

/** Palinsesto completo, dal più imminente. */
export async function listClasses() {
  return unwrap(
    await db().from('classes').select('*').order('start_time', { ascending: true })
  );
}

/** Dettaglio di un corso. */
export async function getClass(id) {
  return unwrap(
    await db().from('classes').select('*').eq('id', id).single(),
    { [PG.NO_SINGLE_ROW]: 'Corso non trovato' }
  );
}

/** Crea un corso (solo admin). `start_time` è ISO 8601. */
export async function createClass({ name, description, trainer_id, start_time, max_capacity }) {
  return unwrap(
    await db()
      .from('classes')
      .insert({ name, description, trainer_id, start_time, max_capacity })
      .select()
      .single(),
    {
      ...MESSAGES,
      [PG.CHECK_VIOLATION]: 'La capacità massima deve essere almeno 1',
      [PG.FOREIGN_KEY]: 'Il trainer indicato non esiste',
    }
  );
}

/** Modifica un corso (solo admin). Passa solo i campi da cambiare. */
export async function updateClass(id, fields) {
  return unwrap(
    await db().from('classes').update(fields).eq('id', id).select().single(),
    {
      ...MESSAGES,
      [PG.CHECK_VIOLATION]: 'La capacità massima deve essere almeno 1',
      [PG.FOREIGN_KEY]: 'Il trainer indicato non esiste',
    }
  );
}

/**
 * Elimina un corso (solo admin). Le prenotazioni collegate cadono con lui
 * (`on delete cascade` su bookings.class_id).
 * `.select()` serve a distinguere "eliminato" da "nessuna riga corrispondente":
 * senza, una delete bloccata dalla RLS sembrerebbe riuscita.
 */
export async function deleteClass(id) {
  const rows = unwrap(await db().from('classes').delete().eq('id', id).select('id'));
  if (!rows?.length) {
    throw new Error('Corso non trovato (o non hai i permessi per eliminarlo)');
  }
  return true;
}
