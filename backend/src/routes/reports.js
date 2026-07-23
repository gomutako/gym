// =====================================================
// Rotte /api/reports — reportistica di base (solo admin).
//   GET /api/reports/attendance   riepilogo presenze/prenotazioni per corso
// =====================================================
import { supabaseAdmin } from '../lib/supabase.js';

export default async function reportsRoutes(fastify) {
  const { authenticate, requireRole } = fastify;

  fastify.get(
    '/api/reports/attendance',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      // Corsi + prenotazioni, aggregati lato server
      const [{ data: classes, error: e1 }, { data: bookings, error: e2 }] =
        await Promise.all([
          supabaseAdmin
            .from('classes')
            .select('id, name, start_time, max_capacity')
            .order('start_time', { ascending: true }),
          supabaseAdmin.from('bookings').select('class_id'),
        ]);

      if (e1 || e2) return reply.code(500).send({ error: (e1 || e2).message });

      // Conta le prenotazioni per corso
      const countByClass = {};
      for (const b of bookings) {
        countByClass[b.class_id] = (countByClass[b.class_id] || 0) + 1;
      }

      const rows = classes.map((c) => ({
        ...c,
        booked: countByClass[c.id] || 0,
        fillRate: c.max_capacity
          ? Math.round(((countByClass[c.id] || 0) / c.max_capacity) * 100)
          : 0,
      }));

      // Totali complessivi
      const totals = {
        classes: classes.length,
        bookings: bookings.length,
        avgFillRate: rows.length
          ? Math.round(rows.reduce((s, r) => s + r.fillRate, 0) / rows.length)
          : 0,
      };

      return { totals, rows };
    }
  );
}
