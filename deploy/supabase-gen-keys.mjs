// =====================================================
// Genera le chiavi per Supabase self-host: JWT_SECRET + ANON_KEY +
// SERVICE_ROLE_KEY (JWT HS256 firmati col secret, come fa Supabase),
// più password Postgres/Dashboard. Nessuna dipendenza esterna.
//   Uso:  node deploy/supabase-gen-keys.mjs
// =====================================================
import crypto from 'node:crypto';

const b64url = (input) => Buffer.from(input).toString('base64url');

function signJwt(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

const jwtSecret = crypto.randomBytes(32).toString('hex'); // 64 caratteri
const iat = Math.floor(Date.now() / 1000);
const exp = iat + 60 * 60 * 24 * 365 * 10; // valide 10 anni

const anonKey = signJwt({ role: 'anon', iss: 'supabase', iat, exp }, jwtSecret);
const serviceKey = signJwt({ role: 'service_role', iss: 'supabase', iat, exp }, jwtSecret);
const postgresPassword = crypto.randomBytes(24).toString('base64url');
const dashboardPassword = crypto.randomBytes(12).toString('base64url');

const line = '─'.repeat(60);
console.log(`\n${line}\n  CHIAVI SUPABASE SELF-HOST — conservale in un posto sicuro\n${line}\n`);
console.log('# → in supabase/docker/.env');
console.log(`JWT_SECRET=${jwtSecret}`);
console.log(`ANON_KEY=${anonKey}`);
console.log(`SERVICE_ROLE_KEY=${serviceKey}`);
console.log(`POSTGRES_PASSWORD=${postgresPassword}`);
console.log(`DASHBOARD_PASSWORD=${dashboardPassword}`);
console.log('\n# → in backend/.env (SUPABASE_URL resta http://127.0.0.1:8000)');
console.log(`SUPABASE_ANON_KEY=${anonKey}`);
console.log(`SUPABASE_SERVICE_ROLE_KEY=${serviceKey}`);
console.log('\n# → in frontend/.env.production (URL pubblico del tuo dominio)');
console.log(`VITE_SUPABASE_ANON_KEY=${anonKey}`);
console.log(`\n${line}\n`);
