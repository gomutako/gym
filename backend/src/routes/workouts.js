// =====================================================
// Rotte /api/workouts — schede di allenamento.
//   GET   /api/workouts/member/:memberId   schede di un member
//                                          (il member solo le proprie; trainer/admin qualsiasi)
//   POST  /api/workouts                    crea scheda (trainer/admin)
//   PATCH /api/workouts/:id                modifica scheda (trainer/admin)
//   PATCH /api/workouts/:id/active         imposta "in uso" (member/trainer/admin)
//   PATCH /api/workouts/:id/archived       archivia/ripristina (member/trainer/admin)
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
    goal: { type: ['string', 'null'] }, // tipo/obiettivo (testo libero)
    level: { type: ['string', 'null'] }, // livello (testo libero)
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

  // --- Attiva/disattiva scheda (member sulle proprie, trainer/admin qualsiasi) ---
  // Esclusiva per member: attivarne una disattiva le altre dello stesso member.
  fastify.patch(
    '/api/workouts/:id/active',
    {
      preHandler: [authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['is_active'],
          additionalProperties: false,
          properties: { is_active: { type: 'boolean' } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { is_active } = request.body;

      const { data: w, error: loadErr } = await supabaseAdmin
        .from('workouts')
        .select('id, member_id')
        .eq('id', id)
        .single();
      if (loadErr || !w) return reply.code(404).send({ error: 'Scheda non trovata' });

      // Il member può agire solo sulle proprie schede
      if (request.userRole === 'member' && w.member_id !== request.user.id) {
        return reply.code(403).send({ error: 'Accesso negato' });
      }

      // Esclusività: prima libero le altre del member, poi imposto questa
      // (l'indice unico parziale garantisce al più una attiva per member).
      if (is_active) {
        const { error: clearErr } = await supabaseAdmin
          .from('workouts')
          .update({ is_active: false })
          .eq('member_id', w.member_id)
          .neq('id', id);
        if (clearErr) return reply.code(400).send({ error: clearErr.message });
      }

      // Mettere in uso una scheda la riporta anche fuori dall'archivio
      const { data, error } = await supabaseAdmin
        .from('workouts')
        .update(is_active ? { is_active: true, archived: false } : { is_active: false })
        .eq('id', id)
        .select()
        .single();

      if (error) return reply.code(400).send({ error: error.message });
      return data;
    }
  );

  // --- Archivia/ripristina scheda (member sulle proprie, trainer/admin qualsiasi) ---
  // Archiviare la nasconde dalle combobox di selezione; una scheda archiviata
  // non può restare "in uso" (invariante).
  fastify.patch(
    '/api/workouts/:id/archived',
    {
      preHandler: [authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['archived'],
          additionalProperties: false,
          properties: { archived: { type: 'boolean' } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { archived } = request.body;

      const { data: w, error: loadErr } = await supabaseAdmin
        .from('workouts')
        .select('id, member_id')
        .eq('id', id)
        .single();
      if (loadErr || !w) return reply.code(404).send({ error: 'Scheda non trovata' });

      if (request.userRole === 'member' && w.member_id !== request.user.id) {
        return reply.code(403).send({ error: 'Accesso negato' });
      }

      const { data, error } = await supabaseAdmin
        .from('workouts')
        // archiviare azzera "in uso" (invariante in uso ⇒ non archiviata)
        .update(archived ? { archived: true, is_active: false } : { archived: false })
        .eq('id', id)
        .select()
        .single();

      if (error) return reply.code(400).send({ error: error.message });
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
