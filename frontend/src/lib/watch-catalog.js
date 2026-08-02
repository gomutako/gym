// =====================================================
// Cache delle schede spinta sul Watch.
//
// Il Watch non ha credenziali Supabase: i valori suggeriti devono arrivare
// GIÀ risolti. Il payload porta solo ciò che serve al polso — niente
// immagini, niente istruzioni, niente catalogo completo: passa da
// WatchConnectivity, non da una rete.
//
// Trasporto: updateApplicationContext, che conserva solo l'ultimo stato.
// È la semantica giusta per una cache e non lascia code da smaltire.
// =====================================================
import * as watch from '@/lib/watch';
import { buildSnapshotLog, getLastCompletedSets } from '@/lib/data/sessions';
import { listExerciseNamesByIds } from '@/lib/data/exercises';

/**
 * `workouts` sono le schede del member, GIÀ LETTE dal chiamante (in
 * TrainingView è `schede.value`, appena tornato da `listWorkoutsForMember`):
 * pushCatalog non le rilegge, per non pagare due volte la stessa query nello
 * stesso giro di `load()`. Il filtro attiva/non archiviata resta qui dentro,
 * perché è pushCatalog a decidere cosa merita di finire al polso.
 */
export async function pushCatalog(memberId, workouts) {
  if (!watch.isSupported()) return { pushed: false, reason: 'non supportato' };

  // getLink e NON getState: quest'ultima svuota il buffer, e qui serve solo
  // sapere se il Watch c'è — scartare messaggi che non abbiamo intenzione di
  // consumare perderebbe le serie chiuse al polso.
  const state = await watch.getLink();
  if (!state.paired || !state.installed) {
    return { pushed: false, reason: 'app non installata sul Watch' };
  }

  const activeWorkouts = (workouts || []).filter((w) => w.is_active && !w.archived);

  // Un'unica query per i nomi, filtrata sui soli id davvero referenziati
  // dalle giornate da spingere: non il catalogo intero (~873 righe con
  // istruzioni e immagini), che sarebbe egress sprecato per leggere solo
  // `.name`.
  const exerciseIds = [...new Set(
    activeWorkouts
      .flatMap((w) => (w.days_json || []).flatMap((d) => (d.exercises || []).map((e) => e.exercise_id)))
      .filter(Boolean)
  )];
  const names = await listExerciseNamesByIds(exerciseIds);
  const nameById = Object.fromEntries(names.map((e) => [e.id, e.name]));

  // Calcolata una sola volta per l'intera cache: senza, ogni giornata di ogni
  // scheda ripeterebbe la stessa interrogazione "ultime sessioni completate".
  const lastSets = await getLastCompletedSets(memberId);

  const payload = {
    type: 'catalog',
    synced_at: new Date().toISOString(),
    workouts: await Promise.all(activeWorkouts.map(async (w) => ({
      id: w.id,
      title: w.title,
      days: await Promise.all((w.days_json || []).map(async (day, index) => {
        const log = await buildSnapshotLog(day.exercises || [], memberId, lastSets);
        return {
          index,
          name: day.name || `Giornata ${index + 1}`,
          exercises: log.map((ex) => ({
            exercise_id: ex.exercise_id,
            name: nameById[ex.exercise_id] || 'Esercizio',
            reps: ex.target_reps,
            rest_seconds: ex.rest_seconds,
            load_type: ex.load_type,
            has_incline: ex.has_incline,
            // Gli uid NON vengono spinti qui: la cache è un modello, non una
            // sessione. Gli uid definitivi nascono quando il Watch apre la
            // sessione, altrimenti due sessioni dalla stessa cache
            // condividerebbero le identità delle serie.
            suggested: ex.sets_log.map((r) => ({
              reps: r.reps, load: r.load,
              ...(ex.has_incline ? { incline: r.incline ?? null } : {}),
            })),
          })),
        };
      })),
    }))),
  };

  await watch.setContext(payload);
  return { pushed: true, workouts: payload.workouts.length };
}
