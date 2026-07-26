// =====================================================
// Rotte /api/admin/diagnostics — diagnostica di servizio (solo admin).
//   GET /api/admin/diagnostics   versione del backend, stato del DB, uptime
//
// Serve a rispondere alla domanda "il servizio che sto interrogando è quello
// che credo?": un backend raggiungibile ma più vecchio dell'app scarta in
// silenzio i campi che non conosce, e il sintomo è un dato che non si salva
// senza alcun errore.
//
// `/api/health` resta pubblico e anonimo: qui invece si descrive
// l'infrastruttura, quindi tutto sta dietro requireRole('admin').
// =====================================================
import { readFileSync } from 'node:fs';
import { supabaseAdmin } from '../lib/supabase.js';

// La versione si legge dal package.json del backend. Si usa readFileSync e non
// `import ... with { type: 'json' }` perché in Node 22 gli import JSON sono
// ancora sperimentali e stampano un warning a ogni avvio.
const pkg = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
);

export default async function diagnosticsRoutes(fastify) {
  const { authenticate, requireRole } = fastify;

  fastify.get(
    '/api/admin/diagnostics',
    { preHandler: [authenticate, requireRole('admin')] },
    async () => {
      // Query minima solo per misurare che il DB risponda: una riga, una colonna.
      const startedAt = performance.now();
      const { error } = await supabaseAdmin.from('profiles').select('id').limit(1);
      const latency_ms = Math.round(performance.now() - startedAt);

      return {
        version: pkg.version,
        database: {
          ok: !error,
          latency_ms,
          ...(error ? { error: error.message } : {}),
        },
        uptime_s: Math.round(process.uptime()),
      };
    }
  );
}
