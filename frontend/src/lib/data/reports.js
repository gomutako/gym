// =====================================================
// Livello dati — reportistica admin.
// Sostituisce GET /api/reports/attendance.
//
// Il backend scaricava TUTTE le prenotazioni e le contava in JavaScript. Qui si
// usa il conteggio aggregato di PostgREST (`bookings(count)` sulla relazione
// incorporata): il totale per corso lo calcola Postgres e in rete passa una riga
// per corso invece di una per prenotazione. Con l'egress limitato del piano free
// è la differenza fra un report che cresce col tempo e uno che resta costante.
//
// L'aggregazione resta corretta perché la RLS mostra all'admin tutte le
// prenotazioni: un trainer che chiamasse questa funzione vedrebbe i conteggi dei
// soli propri corsi, un member zero. Non è un buco — è la stessa policy che
// governa il resto — ma la vista che la usa è riservata all'admin.
// =====================================================
import { db, unwrap } from './client.js';

/**
 * Riepilogo presenze: una riga per corso con prenotati e tasso di riempimento,
 * più i totali complessivi.
 */
export async function getAttendanceReport() {
  const classes = unwrap(
    await db()
      .from('classes')
      .select('id, name, start_time, max_capacity, bookings(count)')
      .order('start_time', { ascending: true })
  );

  const rows = (classes || []).map((c) => {
    // PostgREST restituisce la relazione aggregata come [{ count: n }]
    const booked = c.bookings?.[0]?.count ?? 0;
    const { bookings, ...rest } = c;
    return {
      ...rest,
      booked,
      fillRate: c.max_capacity ? Math.round((booked / c.max_capacity) * 100) : 0,
    };
  });

  const totals = {
    classes: rows.length,
    bookings: rows.reduce((sum, r) => sum + r.booked, 0),
    avgFillRate: rows.length
      ? Math.round(rows.reduce((sum, r) => sum + r.fillRate, 0) / rows.length)
      : 0,
  };

  return { totals, rows };
}
