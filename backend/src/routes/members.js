// =====================================================
// Rotte /api/members — elenco clienti (per trainer e admin).
//   GET   /api/members            lista dei member
//   PATCH /api/members/:id        aggiorna abbonamento/ruolo (solo admin)
// =====================================================
import { supabaseAdmin } from '../lib/supabase.js';

export default async function membersRoutes(fastify) {
  const { authenticate, requireRole } = fastify;

  // --- Lista COMPLETA utenti (tutti i ruoli): solo admin, con email ---
  fastify.get(
    '/api/users',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { data: profiles, error } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, role, subscription_end_date')
        .order('role', { ascending: true });

      if (error) return reply.code(500).send({ error: error.message });

      // Arricchisci con l'email (che sta in auth.users, non in profiles)
      const { data: authList } = await supabaseAdmin.auth.admin.listUsers();
      const emailById = Object.fromEntries(
        (authList?.users || []).map((u) => [u.id, u.email])
      );

      return profiles.map((p) => ({ ...p, email: emailById[p.id] || null }));
    }
  );

  // --- Lista member: trainer e admin (serve per assegnare le schede) ---
  fastify.get(
    '/api/members',
    { preHandler: [authenticate, requireRole('trainer', 'admin')] },
    async (request, reply) => {
      const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, subscription_end_date')
        .eq('role', 'member')
        .order('full_name', { ascending: true });

      if (error) return reply.code(500).send({ error: error.message });
      return data;
    }
  );

  // --- Aggiorna abbonamento/ruolo di un utente: solo admin (utile in Fase Admin) ---
  fastify.patch(
    '/api/members/:id',
    {
      preHandler: [authenticate, requireRole('admin')],
      schema: {
        body: {
          type: 'object',
          properties: {
            subscription_end_date: { type: 'string', format: 'date', nullable: true },
            role: { type: 'string', enum: ['admin', 'trainer', 'member'] },
            full_name: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { data, error } = await supabaseAdmin
        .from('profiles')
        .update(request.body)
        .eq('id', request.params.id)
        .select()
        .single();

      if (error) return reply.code(400).send({ error: error.message });
      if (!data) return reply.code(404).send({ error: 'Utente non trovato' });
      return data;
    }
  );
}
