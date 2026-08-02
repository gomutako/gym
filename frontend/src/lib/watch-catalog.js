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
import { listWorkoutsForMember } from '@/lib/data/workouts';
import { buildSnapshotLog } from '@/lib/data/sessions';
import { listExercisesBrief } from '@/lib/data/exercises';

export async function pushCatalog(memberId) {
  if (!watch.isSupported()) return { pushed: false, reason: 'non supportato' };

  // getLink e NON getState: quest'ultima svuota il buffer, e qui serve solo
  // sapere se il Watch c'è — scartare messaggi che non abbiamo intenzione di
  // consumare perderebbe le serie chiuse al polso.
  const state = await watch.getLink();
  if (!state.paired || !state.installed) {
    return { pushed: false, reason: 'app non installata sul Watch' };
  }

  const workouts = (await listWorkoutsForMember(memberId))
    .filter((w) => w.is_active && !w.archived);
  // Brief e non il catalogo intero: qui serve solo il nome, e le ~873 voci
  // complete con istruzioni e immagini sono egress sprecato.
  const catalog = await listExercisesBrief();
  const nameById = Object.fromEntries(catalog.map((e) => [e.id, e.name]));

  const payload = {
    type: 'catalog',
    synced_at: new Date().toISOString(),
    workouts: await Promise.all(workouts.map(async (w) => ({
      id: w.id,
      title: w.title,
      days: await Promise.all((w.days_json || []).map(async (day, index) => {
        const log = await buildSnapshotLog(day.exercises || [], memberId);
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
