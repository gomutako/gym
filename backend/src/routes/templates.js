// =====================================================
// Rotte /api/templates — schede preconfezionate (libreria di programmi pronti).
//   GET    /api/templates            lista (tutti gli autenticati)
//   POST   /api/templates            crea (trainer/admin)
//   PATCH  /api/templates/:id        modifica (trainer/admin)
//   DELETE /api/templates/:id        elimina (trainer/admin)
//   POST   /api/templates/:id/assign assegna a un cliente clonandola in workouts
// Il template non appartiene a un member: l'assegnazione ne fa una COPIA
// indipendente in public.workouts (stessa forma days_json).
// =====================================================
import { supabaseAdmin } from '../lib/supabase.js';

// days_json ha la stessa forma di quello delle schede (workouts).
const dayItemSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    exercises: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          exercise_id: { type: 'string', format: 'uuid' },
          sets: { type: 'integer' },
          reps: { type: 'integer' },
          rest_seconds: { type: 'integer' },
        },
      },
    },
  },
};

const templateBodySchema = {
  type: 'object',
  properties: {
    title: { type: 'string', minLength: 1 },
    description: { type: ['string', 'null'] },
    goal: { type: ['string', 'null'] },
    level: { type: ['string', 'null'] },
    days_json: { type: 'array', items: dayItemSchema },
  },
};

export default async function templatesRoutes(fastify) {
  const { authenticate, requireRole } = fastify;

  // --- Libreria completa ---
  fastify.get(
    '/api/templates',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { data, error } = await supabaseAdmin
        .from('workout_templates')
        .select('*')
        .order('title', { ascending: true });

      if (error) return reply.code(500).send({ error: error.message });
      return data;
    }
  );

  // --- Crea template (trainer/admin) ---
  fastify.post(
    '/api/templates',
    {
      preHandler: [authenticate, requireRole('trainer', 'admin')],
      schema: { body: { ...templateBodySchema, required: ['title'] } },
    },
    async (request, reply) => {
      const { data, error } = await supabaseAdmin
        .from('workout_templates')
        .insert(request.body)
        .select()
        .single();

      if (error) return reply.code(400).send({ error: error.message });
      return reply.code(201).send(data);
    }
  );

  // --- Modifica template (trainer/admin) ---
  fastify.patch(
    '/api/templates/:id',
    {
      preHandler: [authenticate, requireRole('trainer', 'admin')],
      schema: { body: { ...templateBodySchema, minProperties: 1, additionalProperties: false } },
    },
    async (request, reply) => {
      const { data, error } = await supabaseAdmin
        .from('workout_templates')
        .update(request.body)
        .eq('id', request.params.id)
        .select()
        .single();

      if (error) {
        if (error.code === 'PGRST116') return reply.code(404).send({ error: 'Template non trovato' });
        return reply.code(400).send({ error: error.message });
      }
      return data;
    }
  );

  // --- Elimina template (trainer/admin) ---
  fastify.delete(
    '/api/templates/:id',
    { preHandler: [authenticate, requireRole('trainer', 'admin')] },
    async (request, reply) => {
      const { error } = await supabaseAdmin
        .from('workout_templates')
        .delete()
        .eq('id', request.params.id);

      if (error) return reply.code(400).send({ error: error.message });
      return reply.code(204).send();
    }
  );

  // --- Assegna a un cliente: clona il template in una scheda (workouts) ---
  fastify.post(
    '/api/templates/:id/assign',
    {
      preHandler: [authenticate, requireRole('trainer', 'admin')],
      schema: {
        body: {
          type: 'object',
          required: ['member_id'],
          properties: { member_id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      // 1. Carica il template
      const { data: tpl, error: tplErr } = await supabaseAdmin
        .from('workout_templates')
        .select('*')
        .eq('id', request.params.id)
        .single();

      if (tplErr) {
        if (tplErr.code === 'PGRST116') return reply.code(404).send({ error: 'Template non trovato' });
        return reply.code(400).send({ error: tplErr.message });
      }

      // 2. Verifica che il destinatario sia un member
      const { data: target, error: memErr } = await supabaseAdmin
        .from('profiles')
        .select('id, role')
        .eq('id', request.body.member_id)
        .single();

      if (memErr || !target) return reply.code(404).send({ error: 'Cliente non trovato' });
      if (target.role !== 'member') {
        return reply.code(400).send({ error: 'La scheda può essere assegnata solo a un cliente' });
      }

      // 3. Clona in una nuova scheda indipendente del cliente
      const { data, error } = await supabaseAdmin
        .from('workouts')
        .insert({
          member_id: target.id,
          trainer_id: request.user.id,
          title: tpl.title,
          notes: tpl.description,
          goal: tpl.goal,
          level: tpl.level,
          days_json: tpl.days_json,
        })
        .select()
        .single();

      if (error) return reply.code(400).send({ error: error.message });
      return reply.code(201).send(data);
    }
  );
}
