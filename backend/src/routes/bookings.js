// =====================================================
// Rotte /api/bookings — prenotazioni ai corsi.
//   GET    /api/bookings              le proprie prenotazioni (member)
//   GET    /api/bookings/class/:id    partecipanti a un corso (trainer del corso / admin)
//   POST   /api/bookings              prenota un corso (member) + controllo capacità
//   DELETE /api/bookings/:id          annulla la propria prenotazione (o admin)
//
// Nota: la RLS del DB è la difesa finale; qui aggiungiamo controlli
// espliciti per messaggi d'errore chiari e per la capacità (che la RLS
// da sola non può verificare, servendo la conta di TUTTE le prenotazioni).
// =====================================================
import { supabaseAdmin } from '../lib/supabase.js';

export default async function bookingsRoutes(fastify) {
  const { authenticate, requireRole } = fastify;

  // --- LE MIE PRENOTAZIONI (member): include i dati del corso ---
  fastify.get(
    '/api/bookings',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { data, error } = await supabaseAdmin
        .from('bookings')
        .select('id, created_at, classes(*)')
        .eq('member_id', request.user.id)
        .order('created_at', { ascending: false });

      if (error) return reply.code(500).send({ error: error.message });
      return data;
    }
  );

  // --- PARTECIPANTI A UN CORSO: solo trainer titolare del corso o admin ---
  fastify.get(
    '/api/bookings/class/:id',
    { preHandler: [authenticate, requireRole('admin', 'trainer')] },
    async (request, reply) => {
      const classId = request.params.id;

      // Un trainer può vedere solo i partecipanti dei PROPRI corsi
      if (request.userRole === 'trainer') {
        const { data: klass } = await supabaseAdmin
          .from('classes')
          .select('trainer_id')
          .eq('id', classId)
          .single();

        if (!klass || klass.trainer_id !== request.user.id) {
          return reply.code(403).send({ error: 'Non sei il trainer di questo corso' });
        }
      }

      const { data, error } = await supabaseAdmin
        .from('bookings')
        .select('id, created_at, profiles:member_id(id, full_name)')
        .eq('class_id', classId);

      if (error) return reply.code(500).send({ error: error.message });
      return data;
    }
  );

  // --- PRENOTA un corso (member) ---
  fastify.post(
    '/api/bookings',
    {
      preHandler: [authenticate, requireRole('member', 'admin')],
      schema: {
        body: {
          type: 'object',
          required: ['class_id'],
          properties: { class_id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      const { class_id } = request.body;
      const memberId = request.user.id;

      // 1. Il corso esiste?
      const { data: klass, error: classErr } = await supabaseAdmin
        .from('classes')
        .select('id, max_capacity')
        .eq('id', class_id)
        .single();

      if (classErr || !klass) {
        return reply.code(404).send({ error: 'Corso non trovato' });
      }

      // 2. Controllo capacità: conta le prenotazioni esistenti
      const { count, error: countErr } = await supabaseAdmin
        .from('bookings')
        .select('*', { count: 'exact', head: true })
        .eq('class_id', class_id);

      if (countErr) return reply.code(500).send({ error: countErr.message });
      if (count >= klass.max_capacity) {
        return reply.code(409).send({ error: 'Corso al completo' });
      }

      // 3. Inserisci (il vincolo UNIQUE del DB blocca eventuali doppioni)
      const { data, error } = await supabaseAdmin
        .from('bookings')
        .insert({ class_id, member_id: memberId })
        .select()
        .single();

      if (error) {
        // 23505 = violazione unique -> già prenotato
        if (error.code === '23505') {
          return reply.code(409).send({ error: 'Sei già prenotato a questo corso' });
        }
        return reply.code(400).send({ error: error.message });
      }

      return reply.code(201).send(data);
    }
  );

  // --- ANNULLA prenotazione: solo la propria (o admin) ---
  fastify.delete(
    '/api/bookings/:id',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const bookingId = request.params.id;

      // Verifica proprietà prima di cancellare (a meno che sia admin)
      const { data: booking } = await supabaseAdmin
        .from('bookings')
        .select('member_id')
        .eq('id', bookingId)
        .single();

      if (!booking) return reply.code(404).send({ error: 'Prenotazione non trovata' });

      const isOwner = booking.member_id === request.user.id;
      if (!isOwner && request.userRole !== 'admin') {
        return reply.code(403).send({ error: 'Non puoi annullare questa prenotazione' });
      }

      const { error } = await supabaseAdmin
        .from('bookings')
        .delete()
        .eq('id', bookingId);

      if (error) return reply.code(400).send({ error: error.message });
      return reply.code(204).send();
    }
  );
}
