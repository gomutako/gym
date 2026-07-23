// =====================================================
// Rotte /api/workouts — schede di allenamento.
//   GET   /api/workouts/member/:memberId   schede di un member
//                                          (il member solo le proprie; trainer/admin qualsiasi)
//   POST  /api/workouts                    crea scheda (trainer/admin)
//   PATCH /api/workouts/:id                modifica scheda (trainer/admin)
// =====================================================
import { supabaseAdmin } from '../lib/supabase.js';

// Schema del body: scheda con titolo, note e GIORNATE.
// Ogni giornata ha una lista di esercizi che referenziano il catalogo
// (exercise_id) con i parametri della singola assegnazione (incl. recupero).
const exerciseItemSchema = {
  type: 'object',
  properties: {
    exercise_id: { type: 'string', format: 'uuid' }, // FK logica al catalogo
    sets: { type: 'integer' },
    reps: { type: 'integer' },
    rest_seconds: { type: 'integer' }, // recupero tra le serie (secondi)
  },
};

const workoutBodySchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    notes: { type: 'string' },
    days_json: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' }, // es. "Giorno A"
          exercises: { type: 'array', items: exerciseItemSchema },
        },
      },
    },
  },
};

export default async function workoutsRoutes(fastify) {
  const { authenticate, requireRole } = fastify;

  // --- Schede di un member ---
  fastify.get(
    '/api/workouts/member/:memberId',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { memberId } = request.params;

      // Un member può leggere solo le proprie schede
      if (request.userRole === 'member' && memberId !== request.user.id) {
        return reply.code(403).send({ error: 'Accesso negato' });
      }

      const { data, error } = await supabaseAdmin
        .from('workouts')
        .select('*')
        .eq('member_id', memberId)
        .order('created_at', { ascending: false });

      if (error) return reply.code(500).send({ error: error.message });
      return data;
    }
  );

  // --- Crea scheda (trainer/admin) ---
  fastify.post(
    '/api/workouts',
    {
      preHandler: [authenticate, requireRole('trainer', 'admin')],
      schema: {
        body: {
          ...workoutBodySchema,
          required: ['member_id'],
          properties: {
            ...workoutBodySchema.properties,
            member_id: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    async (request, reply) => {
      // Il trainer che crea diventa l'autore della scheda
      const payload = { ...request.body, trainer_id: request.user.id };

      const { data, error } = await supabaseAdmin
        .from('workouts')
        .insert(payload)
        .select()
        .single();

      if (error) return reply.code(400).send({ error: error.message });
      return reply.code(201).send(data);
    }
  );

  // --- Modifica scheda (trainer/admin) ---
  fastify.patch(
    '/api/workouts/:id',
    {
      preHandler: [authenticate, requireRole('trainer', 'admin')],
      schema: { body: workoutBodySchema },
    },
    async (request, reply) => {
      const { data, error } = await supabaseAdmin
        .from('workouts')
        .update(request.body)
        .eq('id', request.params.id)
        .select()
        .single();

      if (error) return reply.code(400).send({ error: error.message });
      if (!data) return reply.code(404).send({ error: 'Scheda non trovata' });
      return data;
    }
  );

  // --- Elimina scheda (trainer/admin) ---
  fastify.delete(
    '/api/workouts/:id',
    { preHandler: [authenticate, requireRole('trainer', 'admin')] },
    async (request, reply) => {
      const { error } = await supabaseAdmin
        .from('workouts')
        .delete()
        .eq('id', request.params.id);

      if (error) return reply.code(400).send({ error: error.message });
      return reply.code(204).send();
    }
  );
}
