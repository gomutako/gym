// =====================================================
// Rotte /api/profile — profilo dell'utente CORRENTE (self-service).
//   GET   /api/profile   legge il proprio profilo
//   PATCH /api/profile   aggiorna nome/cognome, telefono, avatar del PROPRIO profilo
// full_name è una colonna generata da first_name/last_name: si scrivono quelli.
// Ruolo e abbonamento NON sono modificabili qui: restano di competenza
// dell'admin (PATCH /api/members/:id). Usiamo supabaseAdmin ma scriviamo
// sempre e solo sulla riga di request.user.id.
// =====================================================
import { supabaseAdmin } from '../lib/supabase.js';

export default async function profileRoutes(fastify) {
  const { authenticate } = fastify;

  fastify.get(
    '/api/profile',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', request.user.id)
        .single();

      if (error) return reply.code(500).send({ error: error.message });
      return data;
    }
  );

  fastify.patch(
    '/api/profile',
    {
      preHandler: [authenticate],
      schema: {
        body: {
          type: 'object',
          minProperties: 1,
          additionalProperties: false,
          properties: {
            first_name: { type: 'string', minLength: 1 },
            last_name: { type: ['string', 'null'] },
            phone: { type: ['string', 'null'] },
            avatar_path: { type: ['string', 'null'] },
            // Dati anagrafici/fisici (opzionali)
            gender: { type: ['string', 'null'], enum: ['uomo', 'donna', 'altro', null] },
            birth_date: { type: ['string', 'null'] }, // 'YYYY-MM-DD'
            height_cm: { type: ['number', 'null'] },
            weight_kg: { type: ['number', 'null'] },
            notes: { type: ['string', 'null'] },
          },
        },
      },
    },
    async (request, reply) => {
      // additionalProperties:false rimuove eventuali campi non ammessi
      // (es. role): dopo la validazione il body può risultare vuoto.
      if (!Object.keys(request.body).length) {
        return reply.code(400).send({ error: 'Nessun campo da aggiornare' });
      }

      const { data, error } = await supabaseAdmin
        .from('profiles')
        .update(request.body)
        .eq('id', request.user.id)
        .select()
        .single();

      if (error) return reply.code(400).send({ error: error.message });
      return data;
    }
  );
}
