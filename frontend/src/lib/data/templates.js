// =====================================================
// Livello dati — schede preconfezionate (libreria di programmi pronti).
// Sostituisce /api/templates (GET, POST, PATCH, DELETE).
// L'assegnazione a un cliente sta in workouts.js (assignTemplate), perché
// il risultato è una scheda in `workouts`, non un template.
//
// Autorizzazione dalla RLS: lettura a tutti gli autenticati (la libreria è
// consultabile), scrittura a trainer/admin.
//
// `days_json` ha la stessa forma delle schede:
//   [{ name, exercises: [{ exercise_id, sets, reps, rest_seconds }] }]
// La forma è verificata dal trigger workout_templates_guard_days_json: un
// payload malformato torna con codice 22023 e messaggio già in italiano.
// =====================================================
import { db, unwrap, PG } from './client.js';

const WRITABLE = ['title', 'description', 'goal', 'level', 'days_json'];

const MESSAGES = {
  [PG.NO_SINGLE_ROW]: 'Scheda preconfezionata non trovata (o non hai i permessi)',
  [PG.NOT_AUTHORIZED]: 'Solo un trainer o un amministratore può gestire la libreria',
};

function pickWritable(fields) {
  const out = {};
  for (const key of WRITABLE) {
    if (fields[key] !== undefined) out[key] = fields[key];
  }
  return out;
}

/** Libreria completa, in ordine alfabetico. */
export async function listTemplates() {
  return unwrap(
    await db().from('workout_templates').select('*').order('title', { ascending: true })
  );
}

/** Crea un template (trainer/admin). */
export async function createTemplate(fields) {
  if (!fields.title) throw new Error('Il titolo è obbligatorio');
  return unwrap(
    await db().from('workout_templates').insert(pickWritable(fields)).select().single(),
    MESSAGES
  );
}

/** Modifica un template (trainer/admin). */
export async function updateTemplate(id, fields) {
  const patch = pickWritable(fields);
  if (Object.keys(patch).length === 0) throw new Error('Nessun campo da aggiornare');
  return unwrap(
    await db().from('workout_templates').update(patch).eq('id', id).select().single(),
    MESSAGES
  );
}

/** Elimina un template (trainer/admin). Le schede già assegnate non si toccano. */
export async function deleteTemplate(id) {
  const rows = unwrap(
    await db().from('workout_templates').delete().eq('id', id).select('id')
  );
  if (!rows?.length) {
    throw new Error('Scheda preconfezionata non trovata (o non hai i permessi per eliminarla)');
  }
  return true;
}
