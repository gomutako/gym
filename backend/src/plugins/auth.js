// =====================================================
// Plugin di autenticazione & autorizzazione.
// - Verifica il JWT Supabase presente nell'header Authorization.
// - Carica l'utente e il suo ruolo (dalla tabella profiles).
// - Espone due decorator:
//     fastify.authenticate          -> preHandler che richiede il login
//     fastify.requireRole(...roles) -> factory di preHandler per il role-guard
// =====================================================
import fp from 'fastify-plugin';
import { supabaseAdmin } from '../lib/supabase.js';

async function authPlugin(fastify) {
  // --- preHandler: richiede un utente autenticato ---
  fastify.decorate('authenticate', async (request, reply) => {
    const header = request.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
      return reply.code(401).send({ error: 'Token di autenticazione mancante' });
    }

    // Verifica il token contro Supabase Auth (GoTrue)
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) {
      return reply.code(401).send({ error: 'Token non valido o scaduto' });
    }

    // Recupera il ruolo dell'utente dal profilo
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role, full_name')
      .eq('id', data.user.id)
      .single();

    if (profileError || !profile) {
      return reply.code(403).send({ error: 'Profilo utente non trovato' });
    }

    // Rende disponibili i dati alle rotte
    request.user = data.user;         // utente Supabase (id, email, ...)
    request.userRole = profile.role;  // 'admin' | 'trainer' | 'member'
    request.accessToken = token;      // utile per query rispettose della RLS
  });

  // --- factory: preHandler che limita l'accesso a certi ruoli ---
  // Uso: { preHandler: [fastify.authenticate, fastify.requireRole('admin')] }
  fastify.decorate('requireRole', (...allowedRoles) => {
    return async (request, reply) => {
      if (!allowedRoles.includes(request.userRole)) {
        return reply.code(403).send({
          error: `Accesso negato: richiesto ruolo ${allowedRoles.join(' o ')}`,
        });
      }
    };
  });
}

// fp() rende i decorator visibili anche fuori dallo scope del plugin
export default fp(authPlugin);
