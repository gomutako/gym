// =====================================================
// Rotte /api/classes — gestione del palinsesto corsi.
//   GET    /api/classes       lettura (tutti gli autenticati)
//   GET    /api/classes/:id   dettaglio (tutti gli autenticati)
//   POST   /api/classes       crea      (solo admin)
//   PATCH  /api/classes/:id   modifica  (solo admin)
//   DELETE /api/classes/:id   elimina   (solo admin)
// =====================================================
import { supabaseAdmin } from '../lib/supabase.js';

// Schema JSON per validare il body in create/update (Fastify valida in automatico)
const classBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    trainer_id: { type: 'string', format: 'uuid', nullable: true },
    start_time: { type: 'string', format: 'date-time' },
    max_capacity: { type: 'integer', minimum: 1 },
  },
};

export default async function classesRoutes(fastify) {
  const { authenticate, requireRole } = fastify;

  // --- LISTA: tutti gli autenticati vedono il palinsesto ---
  fastify.get(
    '/api/classes',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { data, error } = await supabaseAdmin
        .from('classes')
        .select('*')
        .order('start_time', { ascending: true });

      if (error) return reply.code(500).send({ error: error.message });
      return data;
    }
  );

  // --- DETTAGLIO ---
  fastify.get(
    '/api/classes/:id',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { data, error } = await supabaseAdmin
        .from('classes')
        .select('*')
        .eq('id', request.params.id)
        .single();

      if (error) return reply.code(404).send({ error: 'Corso non trovato' });
      return data;
    }
  );

  // --- CREA: solo admin ---
  fastify.post(
    '/api/classes',
    {
      preHandler: [authenticate, requireRole('admin')],
      schema: { body: { ...classBodySchema, required: ['name', 'start_time'] } },
    },
    async (request, reply) => {
      const { data, error } = await supabaseAdmin
        .from('classes')
        .insert(request.body)
        .select()
        .single();

      if (error) return reply.code(400).send({ error: error.message });
      return reply.code(201).send(data);
    }
  );

  // --- MODIFICA: solo admin ---
  fastify.patch(
    '/api/classes/:id',
    {
      preHandler: [authenticate, requireRole('admin')],
      schema: { body: classBodySchema },
    },
    async (request, reply) => {
      const { data, error } = await supabaseAdmin
        .from('classes')
        .update(request.body)
        .eq('id', request.params.id)
        .select()
        .single();

      if (error) return reply.code(400).send({ error: error.message });
      if (!data) return reply.code(404).send({ error: 'Corso non trovato' });
      return data;
    }
  );

  // --- ELIMINA: solo admin ---
  fastify.delete(
    '/api/classes/:id',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { error } = await supabaseAdmin
        .from('classes')
        .delete()
        .eq('id', request.params.id);

      if (error) return reply.code(400).send({ error: error.message });
      return reply.code(204).send();
    }
  );
}
