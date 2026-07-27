// =====================================================
// Livello dati — catalogo esercizi.
// Sostituisce le rotte backend /api/exercises (GET, POST, PATCH, DELETE).
//
// Autorizzazione dalla RLS: `exercises_select` per tutti gli autenticati (il
// member deve vedere immagini e istruzioni nella scheda), `exercises_write`
// solo trainer/admin.
//
// Le immagini NON passano da qui: il client le carica nel bucket Storage
// `exercise-images` (vedi lib/storage.js) e qui si salvano solo i path.
// =====================================================
import { db, unwrap, PG } from './client.js';

// Campi scrivibili. Elenco esplicito invece di passare l'oggetto ricevuto:
// sostituisce `additionalProperties: false` dello schema Fastify, che era
// l'unica cosa a impedire l'invio di colonne non previste.
const WRITABLE = [
  'name', 'muscle_group', 'description', 'load_type', 'has_incline', 'video_url',
  'image_path', 'image_paths', 'equipment', 'category', 'force', 'level',
  'mechanic', 'secondary_muscles', 'instructions',
];

const MESSAGES = {
  [PG.UNIQUE_VIOLATION]: 'Esiste già un esercizio con questo nome',
  [PG.NO_SINGLE_ROW]: 'Esercizio non trovato (o non hai i permessi per modificarlo)',
  [PG.CHECK_VIOLATION]: 'Uno dei valori non è ammesso (carico, livello, forza o meccanica)',
  [PG.NOT_AUTHORIZED]: 'Solo un trainer o un amministratore può gestire il catalogo',
};

function pickWritable(fields) {
  const out = {};
  for (const key of WRITABLE) {
    if (fields[key] !== undefined) out[key] = fields[key];
  }
  return out;
}

/** Catalogo completo, in ordine alfabetico. */
export async function listExercises() {
  return unwrap(
    await db().from('exercises').select('*').order('name', { ascending: true })
  );
}

/**
 * Catalogo ridotto per le viste che mostrano solo le anteprime: evita di
 * trasferire `instructions` e `image_paths` per ~873 voci quando servono
 * nome, muscolo e copertina.
 */
export async function listExercisesBrief() {
  return unwrap(
    await db()
      .from('exercises')
      .select('id, name, muscle_group, image_path, description, video_url, load_type, has_incline, equipment, level, mechanic, force, category, secondary_muscles')
      .order('name', { ascending: true })
  );
}

/** Crea una voce di catalogo (trainer/admin). */
export async function createExercise(fields) {
  if (!fields.name) throw new Error('Il nome dell\'esercizio è obbligatorio');
  return unwrap(
    await db().from('exercises').insert(pickWritable(fields)).select().single(),
    MESSAGES
  );
}

/** Modifica una voce di catalogo (trainer/admin). */
export async function updateExercise(id, fields) {
  const patch = pickWritable(fields);
  if (Object.keys(patch).length === 0) throw new Error('Nessun campo da aggiornare');
  return unwrap(
    await db().from('exercises').update(patch).eq('id', id).select().single(),
    MESSAGES
  );
}

/** Elimina una voce di catalogo (trainer/admin). */
export async function deleteExercise(id) {
  const rows = unwrap(await db().from('exercises').delete().eq('id', id).select('id'));
  if (!rows?.length) {
    throw new Error('Esercizio non trovato (o non hai i permessi per eliminarlo)');
  }
  return true;
}
