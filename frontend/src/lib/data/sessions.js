// =====================================================
// Livello dati — sessioni di allenamento.
// Sostituisce /api/sessions (GET, GET /:id, POST, PATCH).
//
// `startSession` porta qui la logica che stava in backend/src/routes/sessions.js:
// snapshot della giornata scelta + precompilazione dei carichi dall'ultima volta.
// Si può fare lato client senza perdere nulla perché legge SOLO dati del member
// stesso — le proprie schede, le proprie sessioni passate — che la RLS gli
// concede già. Non serviva la service_role key: serviva solo che qualcuno
// scrivesse il codice.
// =====================================================
import { db, unwrap, PG } from './client.js';

// Quante sessioni passate guardare per ritrovare l'ultimo carico usato.
// Come nel backend: un member con molti esercizi diversi può non ritrovare
// tutto entro le 30 più recenti, ma allargare costa banda a ogni avvio.
const PAST_SESSIONS_LOOKBACK = 30;

const MESSAGES = {
  [PG.NO_SINGLE_ROW]: 'Sessione non trovata (o non è tua)',
  [PG.NOT_AUTHORIZED]: 'Non puoi modificare questa sessione',
  [PG.INVALID_VALUE]: 'I dati della sessione non hanno la forma attesa',
};

/** Le proprie sessioni, dalla più recente (calendario e storico). */
export async function listOwnSessions(memberId) {
  return unwrap(
    await db()
      .from('workout_sessions')
      .select('*')
      .eq('member_id', memberId)
      .order('started_at', { ascending: false })
  );
}

/** Dettaglio di una sessione. */
export async function getSession(id) {
  return unwrap(
    await db().from('workout_sessions').select('*').eq('id', id).single(),
    MESSAGES
  );
}

/**
 * Avvia una sessione sulla giornata `dayIndex` della scheda `workoutId`.
 *
 * Fa uno SNAPSHOT della giornata: titolo scheda, nome giornata ed esercizi
 * vengono copiati nella sessione, così storico e calendario restano corretti
 * anche se la scheda viene poi modificata o eliminata.
 */
export async function startSession(workoutId, dayIndex, memberId) {
  // 1. La scheda (la RLS garantisce già che sia leggibile solo se tua o se sei
  //    trainer/admin; il controllo di proprietà resta esplicito per il messaggio)
  const workout = unwrap(
    await db().from('workouts').select('*').eq('id', workoutId).single(),
    { [PG.NO_SINGLE_ROW]: 'Scheda non trovata' }
  );
  if (workout.member_id !== memberId) {
    throw new Error('Questa scheda non è tua');
  }

  const day = (workout.days_json || [])[dayIndex];
  if (!day) throw new Error('Giornata non valida');

  const dayExercises = day.exercises || [];
  const exerciseIds = [...new Set(dayExercises.map((e) => e.exercise_id).filter(Boolean))];

  // 2. Metadati dal catalogo: load_type (kg o livello) e has_incline (pendenza %)
  const metaById = {};
  if (exerciseIds.length) {
    const catalog = unwrap(
      await db().from('exercises').select('id, load_type, has_incline').in('id', exerciseIds)
    );
    for (const c of catalog || []) metaById[c.id] = c;
  }

  // 3. Ultimo carico usato per ciascun esercizio, dalle sessioni COMPLETATE
  const past = unwrap(
    await db()
      .from('workout_sessions')
      .select('exercises_log, completed_at')
      .eq('member_id', memberId)
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(PAST_SESSIONS_LOOKBACK)
  );

  const lastSetsByExercise = {};
  for (const session of past || []) {
    for (const ex of session.exercises_log || []) {
      // le sessioni sono già ordinate dalla più recente: il primo trovato vince
      if (ex.exercise_id && !lastSetsByExercise[ex.exercise_id]) {
        lastSetsByExercise[ex.exercise_id] = ex.sets_log || [];
      }
    }
  }

  // 4. Snapshot: una riga per serie, con reps e carico precompilati
  const exercises_log = dayExercises.map((e) => {
    const prev = lastSetsByExercise[e.exercise_id] || [];
    const nSets = Math.max(1, e.sets || 1);
    const hasIncline = metaById[e.exercise_id]?.has_incline || false;
    const sets_log = Array.from({ length: nSets }, (_, i) => ({
      reps: prev[i]?.reps ?? e.reps ?? null,
      load: prev[i]?.load ?? null,
      // la pendenza esiste solo per gli esercizi che la prevedono (es. tapis roulant)
      ...(hasIncline ? { incline: prev[i]?.incline ?? null } : {}),
      done: false,
    }));
    return {
      exercise_id: e.exercise_id,
      target_reps: e.reps ?? null,
      rest_seconds: e.rest_seconds ?? 0,
      load_type: metaById[e.exercise_id]?.load_type || 'weight',
      has_incline: hasIncline,
      sets_log,
    };
  });

  return unwrap(
    await db()
      .from('workout_sessions')
      .insert({
        member_id: memberId,
        workout_id: workoutId,
        workout_title: workout.title,
        day_index: dayIndex,
        day_name: day.name,
        exercises_log,
      })
      .select()
      .single(),
    MESSAGES
  );
}

/**
 * Aggiorna il log degli esercizi, i dati biometrici e/o completa la sessione.
 * Passa `completed_at` con un timestamp ISO per chiudere l'allenamento, `null`
 * per riaprirlo.
 */
export async function updateSession(id, { exercises_log, completed_at, biometrics_json }) {
  const patch = {};
  if (exercises_log !== undefined) patch.exercises_log = exercises_log;
  if (completed_at !== undefined) patch.completed_at = completed_at;
  if (biometrics_json !== undefined) patch.biometrics_json = biometrics_json;
  if (Object.keys(patch).length === 0) throw new Error('Nessun campo da aggiornare');

  return unwrap(
    await db().from('workout_sessions').update(patch).eq('id', id).select().single(),
    MESSAGES
  );
}

/**
 * Elimina una sessione, completata o no (member proprietario o admin: è quanto
 * concede la policy `sessions_delete`).
 *
 * ⚠️ Sparisce anche dallo storico dei carichi: `startSession` precompila i pesi
 * dall'ultima sessione completata che conteneva l'esercizio, quindi eliminarla
 * fa ripartire la volta dopo dal valore precedente — o da vuoto, se non ce n'è.
 */
export async function deleteSession(id) {
  const rows = unwrap(await db().from('workout_sessions').delete().eq('id', id).select('id'));
  if (!rows?.length) {
    throw new Error('Allenamento non trovato (o non hai i permessi per eliminarlo)');
  }
  return true;
}
