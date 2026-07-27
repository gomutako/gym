// =====================================================
// Livello dati — schede di allenamento.
// Sostituisce /api/workouts (GET /member/:id, POST, PATCH, PATCH /active,
// PATCH /archived, DELETE) e POST /api/templates/:id/assign.
//
// Due semplificazioni rispetto al backend, entrambe perché la regola è passata
// al database (migration 20260727120000):
//
//  1. `setActive` è UN solo update. Il backend faceva due passaggi (azzerava le
//     altre schede del member, poi attivava questa) e restava in race con
//     l'indice unico parziale. Ora `workouts_enforce_single_active` disattiva le
//     altre dentro la stessa transazione.
//  2. `setArchived` non deve passare `is_active: false`: l'invariante
//     "archiviata ⇒ non in uso" la applica lo stesso trigger.
//
// Perimetro di scrittura dalla RLS: l'admin su tutto, il trainer solo sulle
// schede con `trainer_id = auth.uid()`, il member solo su `is_active`/`archived`
// delle proprie (glielo impone `workouts_guard_member_fields`).
// =====================================================
import { db, unwrap, PG } from './client.js';

const WRITABLE = ['title', 'notes', 'goal', 'level', 'days_json'];

const MESSAGES = {
  [PG.NO_SINGLE_ROW]: 'Scheda non trovata (o non hai i permessi per modificarla)',
  [PG.NOT_AUTHORIZED]: 'Non hai i permessi per questa scheda',
  [PG.FOREIGN_KEY]: 'Cliente o trainer indicato non esiste',
};

function pickWritable(fields) {
  const out = {};
  for (const key of WRITABLE) {
    if (fields[key] !== undefined) out[key] = fields[key];
  }
  return out;
}

/** Schede di un member, dalla più recente. */
export async function listWorkoutsForMember(memberId) {
  return unwrap(
    await db()
      .from('workouts')
      .select('*')
      .eq('member_id', memberId)
      .order('created_at', { ascending: false })
  );
}

/** Crea una scheda. Il trainer che la crea ne diventa l'autore. */
export async function createWorkout({ member_id, trainer_id, ...fields }) {
  if (!member_id) throw new Error('Il cliente è obbligatorio');
  return unwrap(
    await db()
      .from('workouts')
      .insert({ member_id, trainer_id, ...pickWritable(fields) })
      .select()
      .single(),
    MESSAGES
  );
}

/** Modifica una scheda (trainer autore o admin). */
export async function updateWorkout(id, fields) {
  const patch = pickWritable(fields);
  if (Object.keys(patch).length === 0) throw new Error('Nessun campo da aggiornare');
  return unwrap(
    await db().from('workouts').update(patch).eq('id', id).select().single(),
    MESSAGES
  );
}

/**
 * Mette o toglie "in uso". Attivandone una, il database disattiva le altre del
 * member e la fa uscire dall'archivio: un solo update, nessuna race.
 */
export async function setWorkoutActive(id, isActive) {
  return unwrap(
    await db().from('workouts').update({ is_active: isActive }).eq('id', id).select().single(),
    MESSAGES
  );
}

/** Archivia o ripristina. Archiviare azzera "in uso" lato database. */
export async function setWorkoutArchived(id, archived) {
  return unwrap(
    await db().from('workouts').update({ archived }).eq('id', id).select().single(),
    MESSAGES
  );
}

/** Elimina una scheda (trainer autore o admin). */
export async function deleteWorkout(id) {
  const rows = unwrap(await db().from('workouts').delete().eq('id', id).select('id'));
  if (!rows?.length) {
    throw new Error('Scheda non trovata (o non hai i permessi per eliminarla)');
  }
  return true;
}

/**
 * Assegna una scheda preconfezionata a un cliente creandone una COPIA
 * indipendente in `workouts` (il template non viene collegato: modificarlo poi
 * non deve toccare le schede già assegnate).
 *
 * Il controllo "il destinatario è un member" resta esplicito come nel backend:
 * assegnare una scheda a un trainer è un errore di interfaccia, non un tentativo
 * di violazione, e va segnalato con un messaggio chiaro.
 */
export async function assignTemplate(templateId, memberId, trainerId) {
  const tpl = unwrap(
    await db().from('workout_templates').select('*').eq('id', templateId).single(),
    { [PG.NO_SINGLE_ROW]: 'Scheda preconfezionata non trovata' }
  );

  const target = unwrap(
    await db().from('profiles').select('id, role').eq('id', memberId).single(),
    { [PG.NO_SINGLE_ROW]: 'Cliente non trovato' }
  );
  if (target.role !== 'member') {
    throw new Error('La scheda può essere assegnata solo a un cliente');
  }

  return unwrap(
    await db()
      .from('workouts')
      .insert({
        member_id: target.id,
        trainer_id: trainerId,
        title: tpl.title,
        notes: tpl.description,
        goal: tpl.goal,
        level: tpl.level,
        days_json: tpl.days_json,
      })
      .select()
      .single(),
    MESSAGES
  );
}
