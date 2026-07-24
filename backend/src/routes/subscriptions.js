// =====================================================
// Rotte /api/subscriptions — storico abbonamenti (periodi).
//   GET    /api/subscriptions/member/:memberId   periodi di un member
//                                                (il member solo i propri; trainer/admin qualsiasi)
//   POST   /api/subscriptions                    crea un periodo (solo admin)
//   DELETE /api/subscriptions/:id                elimina un periodo (solo admin)
// profiles.subscription_end_date è mantenuta in automatico da un trigger DB
// (= max end_date), quindi non va aggiornata qui.
// =====================================================
import { supabaseAdmin } from '../lib/supabase.js';

export default async function subscriptionsRoutes(fastify) {
  const { authenticate, requireRole } = fastify;

  // --- Periodi di un member ---
  fastify.get(
    '/api/subscriptions/member/:memberId',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { memberId } = request.params;

      if (request.userRole === 'member' && memberId !== request.user.id) {
        return reply.code(403).send({ error: 'Accesso negato' });
      }

      const { data, error } = await supabaseAdmin
        .from('subscriptions')
        .select('*')
        .eq('member_id', memberId)
        .order('end_date', { ascending: false });

      if (error) return reply.code(500).send({ error: error.message });
      return data;
    }
  );

  // --- Crea periodo (admin) ---
  fastify.post(
    '/api/subscriptions',
    {
      preHandler: [authenticate, requireRole('admin')],
      schema: {
        body: {
          type: 'object',
          required: ['member_id', 'start_date', 'end_date'],
          additionalProperties: false,
          properties: {
            member_id: { type: 'string', format: 'uuid' },
            start_date: { type: 'string', format: 'date' },
            end_date: { type: 'string', format: 'date' },
          },
        },
      },
    },
    async (request, reply) => {
      if (request.body.end_date < request.body.start_date) {
        return reply.code(400).send({ error: 'La data di fine precede quella di inizio' });
      }

      const { data, error } = await supabaseAdmin
        .from('subscriptions')
        .insert(request.body)
        .select()
        .single();

      if (error) return reply.code(400).send({ error: error.message });
      return reply.code(201).send(data);
    }
  );

  // --- Elimina periodo (admin) ---
  fastify.delete(
    '/api/subscriptions/:id',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { error } = await supabaseAdmin
        .from('subscriptions')
        .delete()
        .eq('id', request.params.id);

      if (error) return reply.code(400).send({ error: error.message });
      return reply.code(204).send();
    }
  );
}
