// =====================================================
// Rotte /api/exercises — catalogo tipi di esercizio.
// L'immagine è condivisa per tipo (caricata su Storage dal client).
//   GET    /api/exercises        catalogo (tutti gli autenticati)
//   POST   /api/exercises        crea voce catalogo (trainer/admin)
//   PATCH  /api/exercises/:id    modifica voce catalogo (trainer/admin)
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
            muscle_group: { type: 'string' }, // muscolo primario
            description: { type: 'string' }, // tecnica/esecuzione
            load_type: { type: 'string', enum: ['weight', 'level'] }, // peso kg vs livello
            has_incline: { type: 'boolean' }, // registra anche la pendenza % (es. tapis roulant)
            video_url: { type: 'string' }, // link video esecuzione (opzionale)
            image_path: { type: 'string' }, // copertina (thumbnail)
            image_paths: { type: 'array', items: { type: 'string' } }, // tutte le immagini (carousel)
            // --- Metadati aggiuntivi (allineati alla fonte free-exercise-db) ---
            equipment: { type: 'string' }, // attrezzatura (testo libero)
            category: { type: 'string' }, // categoria (testo libero)
            force: { type: 'string', enum: ['spinta', 'trazione', 'statico'] },
            level: { type: 'string', enum: ['principiante', 'intermedio', 'avanzato'] },
            mechanic: { type: 'string', enum: ['composto', 'isolamento'] },
            secondary_muscles: { type: 'array', items: { type: 'string' } }, // muscoli secondari
            instructions: { type: 'array', items: { type: 'string' } }, // passi di esecuzione
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

  // --- Modifica voce catalogo (trainer/admin) ---
  // Campi opzionali a null per svuotarli; image_path nuovo = immagine già caricata dal client.
  fastify.patch(
    '/api/exercises/:id',
    {
      preHandler: [authenticate, requireRole('trainer', 'admin')],
      schema: {
        body: {
          type: 'object',
          minProperties: 1,
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1 },
            muscle_group: { type: ['string', 'null'] },
            description: { type: ['string', 'null'] },
            load_type: { type: 'string', enum: ['weight', 'level'] },
            has_incline: { type: 'boolean' },
            video_url: { type: ['string', 'null'] },
            image_path: { type: ['string', 'null'] },
            image_paths: { type: 'array', items: { type: 'string' } }, // [] per svuotare
            // --- Metadati aggiuntivi (null per svuotare) ---
            equipment: { type: ['string', 'null'] },
            category: { type: ['string', 'null'] },
            force: { type: ['string', 'null'], enum: ['spinta', 'trazione', 'statico', null] },
            level: { type: ['string', 'null'], enum: ['principiante', 'intermedio', 'avanzato', null] },
            mechanic: { type: ['string', 'null'], enum: ['composto', 'isolamento', null] },
            secondary_muscles: { type: 'array', items: { type: 'string' } }, // [] per svuotare
            instructions: { type: 'array', items: { type: 'string' } }, // [] per svuotare
          },
        },
      },
    },
    async (request, reply) => {
      // Fastify rimuove i campi non previsti dopo il check di minProperties:
      // un body fatto solo di campi ignoti arriva qui vuoto.
      if (!Object.keys(request.body).length) {
        return reply.code(400).send({ error: 'Nessun campo da aggiornare' });
      }

      const { data, error } = await supabaseAdmin
        .from('exercises')
        .update(request.body)
        .eq('id', request.params.id)
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          return reply.code(409).send({ error: 'Esiste già un esercizio con questo nome' });
        }
        if (error.code === 'PGRST116') {
          return reply.code(404).send({ error: 'Esercizio non trovato' });
        }
        return reply.code(400).send({ error: error.message });
      }
      return data;
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
