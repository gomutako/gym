// =====================================================
// Bootstrap del server Fastify
// In Fase 1 espone solo un health-check. Le rotte /api/*
// verranno registrate in Fase 3.
// =====================================================
import './lib/env.js'; // deve venire prima dei moduli che leggono process.env
import Fastify from 'fastify';
import cors from '@fastify/cors';
import authPlugin from './plugins/auth.js';
import classesRoutes from './routes/classes.js';
import bookingsRoutes from './routes/bookings.js';
import workoutsRoutes from './routes/workouts.js';
import membersRoutes from './routes/members.js';
import reportsRoutes from './routes/reports.js';
import exercisesRoutes from './routes/exercises.js';
import sessionsRoutes from './routes/sessions.js';

const app = Fastify({
  logger: {
    transport: {
      target: 'pino-pretty', // log leggibili in dev (fallback a JSON se assente)
    },
  },
});

// CORS: in produzione impostare CORS_ORIGIN=https://app.tuodominio.com
// (lista separata da virgole). In dev, senza la variabile, accetta qualsiasi origine.
const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
  : true;
await app.register(cors, {
  origin: corsOrigin,
  credentials: true,
});

// Health-check: utile per verificare che il server sia attivo.
// Esposto anche sotto /api perché in produzione Caddy inoltra al backend
// solo il prefisso /api/*, quindi /health non sarebbe raggiungibile dall'esterno.
const health = async () => ({ status: 'ok', service: 'gym-backend' });
app.get('/health', health);
app.get('/api/health', health);

// Plugin di auth (decorator authenticate / requireRole) + rotte API
await app.register(authPlugin);
await app.register(classesRoutes);
await app.register(bookingsRoutes);
await app.register(workoutsRoutes);
await app.register(membersRoutes);
await app.register(reportsRoutes);
await app.register(exercisesRoutes);
await app.register(sessionsRoutes);

// --- Avvio del server ---
const PORT = Number(process.env.PORT) || 3000;

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
