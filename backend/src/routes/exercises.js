// =====================================================
// Rotte /api/exercises — catalogo tipi di esercizio.
// L'immagine è condivisa per tipo (caricata su Storage dal client).
//   GET    /api/exercises        catalogo (tutti gli autenticati)
//   POST   /api/exercises        crea voce catalogo (trainer/admin)
//   DELETE /api/exercises/:id    elimina voce catalogo (trainer/admin)
// =====================================================
import { supabaseAdmin } from '../lib/supabase.js';

export default async function exercisesRoutes(fastify) {
  const { authenticate, requireRole } = fastify;

  // --- Catalogo completo ---
  fastify.get(
    '/api/exercises',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { data, error } = await supabaseAdmin
        .from('exercises')
        .select('*')
        .order('name', { ascending: true });

      if (error) return reply.code(500).send({ error: error.message });
      return data;
    }
  );

  // --- Crea voce catalogo (trainer/admin) ---
  // image_path punta a un file già caricato dal client nel bucket 'exercise-images'
  fastify.post(
    '/api/exercises',
    {
      preHandler: [authenticate, requireRole('trainer', 'admin')],
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1 },
            muscle_group: { type: 'string' },
            description: { type: 'string' }, // tecnica/esecuzione
            load_type: { type: 'string', enum: ['weight', 'level'] }, // peso kg vs livello
            video_url: { type: 'string' }, // link video esecuzione (opzionale)
            image_path: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { data, error } = await supabaseAdmin
        .from('exercises')
        .insert(request.body)
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          return reply.code(409).send({ error: 'Esiste già un esercizio con questo nome' });
        }
        return reply.code(400).send({ error: error.message });
      }
      return reply.code(201).send(data);
    }
  );

  // --- Elimina voce catalogo (trainer/admin) ---
  fastify.delete(
    '/api/exercises/:id',
    { preHandler: [authenticate, requireRole('trainer', 'admin')] },
    async (request, reply) => {
      const { error } = await supabaseAdmin
        .from('exercises')
        .delete()
        .eq('id', request.params.id);

      if (error) return reply.code(400).send({ error: error.message });
      return reply.code(204).send();
    }
  );
}
