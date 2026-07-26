// =====================================================
// Rotte /api/sessions — sessioni di allenamento del member.
//   POST  /api/sessions        inizia una sessione (scheda + giornata) con snapshot
//   GET   /api/sessions        le proprie sessioni (per calendario/storico)
//   GET   /api/sessions/:id    dettaglio sessione
//   PATCH /api/sessions/:id    aggiorna log esercizi / completa la sessione
// =====================================================
import { supabaseAdmin } from '../lib/supabase.js';

export default async function sessionsRoutes(fastify) {
  const { authenticate, requireRole } = fastify;

  // Verifica proprietà (supabaseAdmin bypassa la RLS, quindi controlliamo qui)
  async function loadOwned(id, request, reply) {
    const { data, error } = await supabaseAdmin
      .from('workout_sessions')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !data) {
      reply.code(404).send({ error: 'Sessione non trovata' });
      return null;
    }
    const isOwner = data.member_id === request.user.id;
    if (!isOwner && !['admin', 'trainer'].includes(request.userRole)) {
      reply.code(403).send({ error: 'Accesso negato' });
      return null;
    }
    return data;
  }

  // --- Inizia una sessione: snapshot della giornata scelta ---
  fastify.post(
    '/api/sessions',
    {
      preHandler: [authenticate, requireRole('member', 'admin')],
      schema: {
        body: {
          type: 'object',
          required: ['workout_id', 'day_index'],
          properties: {
            workout_id: { type: 'string', format: 'uuid' },
            day_index: { type: 'integer', minimum: 0 },
          },
        },
      },
    },
    async (request, reply) => {
      const { workout_id, day_index } = request.body;

      // Carica la scheda e verifica che sia del member corrente
      const { data: workout, error } = await supabaseAdmin
        .from('workouts')
        .select('*')
        .eq('id', workout_id)
        .single();
      if (error || !workout) return reply.code(404).send({ error: 'Scheda non trovata' });
      if (workout.member_id !== request.user.id) {
        return reply.code(403).send({ error: 'Questa scheda non è tua' });
      }

      const day = (workout.days_json || [])[day_index];
      if (!day) return reply.code(400).send({ error: 'Giornata non valida' });

      const dayExercises = day.exercises || [];
      const exerciseIds = [...new Set(dayExercises.map((e) => e.exercise_id).filter(Boolean))];

      // Metadati dal catalogo: load_type (peso kg vs livello) e has_incline (pendenza %)
      const metaById = {};
      if (exerciseIds.length) {
        const { data: cat } = await supabaseAdmin
          .from('exercises')
          .select('id, load_type, has_incline')
          .in('id', exerciseIds);
        for (const c of cat || []) metaById[c.id] = c;
      }

      // Prefill: cerca l'ultima sessione COMPLETATA che contiene ciascun esercizio
      // per riproporre reps/carico usati la volta precedente.
      const { data: past } = await supabaseAdmin
        .from('workout_sessions')
        .select('exercises_log, completed_at')
        .eq('member_id', request.user.id)
        .not('completed_at', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(30);

      const lastSetsByExercise = {};
      for (const s of past || []) {
        for (const ex of s.exercises_log || []) {
          if (ex.exercise_id && !lastSetsByExercise[ex.exercise_id]) {
            lastSetsByExercise[ex.exercise_id] = ex.sets_log || [];
          }
        }
      }

      // Snapshot: per ogni esercizio N righe (= serie target), reps target,
      // carico precompilato dalla volta scorsa se disponibile.
      const exercises_log = dayExercises.map((e) => {
        const prev = lastSetsByExercise[e.exercise_id] || [];
        const nSets = Math.max(1, e.sets || 1);
        const hasIncline = metaById[e.exercise_id]?.has_incline || false;
        const sets_log = Array.from({ length: nSets }, (_, i) => ({
          reps: prev[i]?.reps ?? e.reps ?? null,
          load: prev[i]?.load ?? null,
          // pendenza % solo per gli esercizi che la prevedono (es. tapis roulant)
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

      const { data, error: insErr } = await supabaseAdmin
        .from('workout_sessions')
        .insert({
          member_id: request.user.id,
          workout_id,
          workout_title: workout.title,
          day_index,
          day_name: day.name,
          exercises_log,
        })
        .select()
        .single();

      if (insErr) return reply.code(400).send({ error: insErr.message });
      return reply.code(201).send(data);
    }
  );

  // --- Le proprie sessioni (calendario/storico) ---
  fastify.get(
    '/api/sessions',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { data, error } = await supabaseAdmin
        .from('workout_sessions')
        .select('*')
        .eq('member_id', request.user.id)
        .order('started_at', { ascending: false });

      if (error) return reply.code(500).send({ error: error.message });
      return data;
    }
  );

  // --- Dettaglio sessione ---
  fastify.get(
    '/api/sessions/:id',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const session = await loadOwned(request.params.id, request, reply);
      if (session) return session;
    }
  );

  // --- Aggiorna: log esercizi (eseguito) e/o completamento ---
  fastify.patch(
    '/api/sessions/:id',
    {
      preHandler: [authenticate],
      schema: {
        body: {
          type: 'object',
          properties: {
            exercises_log: { type: 'array' },
            completed_at: { type: ['string', 'null'] },
            biometrics_json: {
              type: ['object', 'null'],
              properties: {
                hr_avg: { type: ['integer', 'null'] },
                hr_max: { type: ['integer', 'null'] },
                active_kcal: { type: ['number', 'null'] },
              },
              additionalProperties: false,
            },
          },
        },
      },
    },
    async (request, reply) => {
      const session = await loadOwned(request.params.id, request, reply);
      if (!session) return;
      // Solo il proprietario può modificare
      if (session.member_id !== request.user.id) {
        return reply.code(403).send({ error: 'Accesso negato' });
      }

      const patch = {};
      if (request.body.exercises_log !== undefined) patch.exercises_log = request.body.exercises_log;
      if (request.body.completed_at !== undefined) patch.completed_at = request.body.completed_at;
      if (request.body.biometrics_json !== undefined) patch.biometrics_json = request.body.biometrics_json;

      const { data, error } = await supabaseAdmin
        .from('workout_sessions')
        .update(patch)
        .eq('id', request.params.id)
        .select()
        .single();

      if (error) return reply.code(400).send({ error: error.message });
      return data;
    }
  );
}
