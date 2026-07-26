# Badge stato servizi (dashboard admin) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dare all'admin, dalla propria dashboard, un badge che dice a quale ambiente è connessa l'app, se backend e Supabase rispondono, e se la versione del backend combacia con quella dell'app.

**Architecture:** Le sonde di raggiungibilità partono dal client (è il punto di vista che conta: se è il telefono a non raggiungere il backend, si deve vedere); versione e stato del database li dichiara il backend su una rotta protetta. Raccolta dati (`lib/diagnostics.js`) e presentazione (`ServiceStatusBadge.vue`) sono unità separate.

**Tech Stack:** Fastify (backend), Vue 3 `<script setup>` + Pinia + Tailwind (frontend), Supabase JS, Vite.

Spec di riferimento: `docs/superpowers/specs/2026-07-26-admin-service-status-badge-design.md`

## Global Constraints

- Node ≥ 22 obbligatorio; il backend è ESM (`"type": "module"`).
- Nessun test framework nel progetto: la verifica si fa con **script e2e usa-e-getta**
  (`.mjs` temporanei che fanno login con gli utenti seed e chiamano il backend), da
  rimuovere dopo l'uso. Non aggiungere Jest/Vitest.
- ⚠️ Non usare `pkill`/`pgrep -f "backend/src/server.js"`: il pattern matcha la shell
  stessa. Avviare con `node backend/src/server.js & SVPID=$!` e uccidere per PID.
- `vite build` non termina da solo: verificare l'artefatto (`frontend/dist/index.html`) e
  chiudere per PID. Non usare `| tail` (la pipe bufferizza).
- Utenti seed: `admin@gym.local`, `trainer@gym.local`, `member@gym.local`, password
  `password123`.
- Soglia latenza "lenta" (giallo): **1500 ms**. Timeout per sonda: **5000 ms**.
- Il testo mostrato all'utente è in **italiano**.
- Nessun segreto nel badge: si mostrano gli URL, mai la anon key.

---

### Task 1: Backend — rotta `/api/admin/diagnostics`

**Files:**
- Create: `backend/src/routes/diagnostics.js`
- Modify: `backend/src/server.js` (import + register, accanto alle altre rotte)
- Test: `scripts/tmp-e2e-diagnostics.mjs` (usa-e-getta, rimosso allo Step 7)

**Interfaces:**
- Produces: `GET /api/admin/diagnostics` → `200 { version: string, database: { ok: boolean, latency_ms: number, error?: string }, uptime_s: number }`; `403` per ruoli non-admin; `401` senza token.

- [ ] **Step 1: Scrivi il test e2e (fallirà: la rotta non esiste)**

Crea `scripts/tmp-e2e-diagnostics.mjs`:

```js
// Script e2e usa-e-getta: verifica /api/admin/diagnostics.
// Richiede: supabase locale avviato (npm run db:start), seed eseguito (npm run seed),
// backend in ascolto su :3000.
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY;
if (!ANON) {
  console.error('Serve SUPABASE_ANON_KEY (prendila da `npm run db:status`)');
  process.exit(1);
}
const API = 'http://localhost:3000';

async function tokenFor(email) {
  const sb = createClient(SUPABASE_URL, ANON);
  const { data, error } = await sb.auth.signInWithPassword({ email, password: 'password123' });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  return data.session.access_token;
}

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    console.log(`  FAIL ${name} ${detail}`);
    failures++;
  }
}

// 1) admin: 200 e forma della risposta
const adminToken = await tokenFor('admin@gym.local');
const resAdmin = await fetch(`${API}/api/admin/diagnostics`, {
  headers: { Authorization: `Bearer ${adminToken}` },
});
console.log(`admin -> ${resAdmin.status}`);
check('admin riceve 200', resAdmin.status === 200);
if (resAdmin.status === 200) {
  const body = await resAdmin.json();
  console.log('  body:', JSON.stringify(body));
  check('version è una stringa non vuota', typeof body.version === 'string' && body.version.length > 0);
  check('database.ok è true', body.database?.ok === true);
  check('database.latency_ms è un numero', typeof body.database?.latency_ms === 'number');
  check('uptime_s è un numero', typeof body.uptime_s === 'number');
}

// 2) member: 403 — il controllo che conta davvero
const memberToken = await tokenFor('member@gym.local');
const resMember = await fetch(`${API}/api/admin/diagnostics`, {
  headers: { Authorization: `Bearer ${memberToken}` },
});
console.log(`member -> ${resMember.status}`);
check('member riceve 403', resMember.status === 403);

// 3) senza token: 401
const resAnon = await fetch(`${API}/api/admin/diagnostics`);
console.log(`anonimo -> ${resAnon.status}`);
check('senza token riceve 401', resAnon.status === 401);

console.log(failures === 0 ? '\nTUTTI I CONTROLLI PASSATI' : `\n${failures} CONTROLLI FALLITI`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Avvia l'ambiente e lancia il test — verifica che FALLISCE**

```bash
npm run db:start
npm run seed
npm run db:status          # copia la anon key
node backend/src/server.js & SVPID=$!
sleep 3
SUPABASE_ANON_KEY='<anon key locale>' node scripts/tmp-e2e-diagnostics.mjs
```

Atteso: `admin -> 404` e `FAIL admin riceve 200`. La rotta non esiste ancora.
Lascia il backend acceso (serve allo Step 5); annota `$SVPID`.

- [ ] **Step 3: Scrivi la rotta**

Crea `backend/src/routes/diagnostics.js`:

```js
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
```

- [ ] **Step 4: Registra la rotta**

In `backend/src/server.js`, accanto agli altri import di rotte:

```js
import diagnosticsRoutes from './routes/diagnostics.js';
```

e accanto agli altri `register`, dopo `await app.register(reportsRoutes);`:

```js
await app.register(diagnosticsRoutes);
```

- [ ] **Step 5: Riavvia il backend e rilancia il test — verifica che PASSA**

```bash
kill $SVPID
node backend/src/server.js & SVPID=$!
sleep 3
SUPABASE_ANON_KEY='<anon key locale>' node scripts/tmp-e2e-diagnostics.mjs
```

Atteso: `TUTTI I CONTROLLI PASSATI` (admin 200, member 403, anonimo 401).

- [ ] **Step 6: Ferma il backend**

```bash
kill $SVPID
```

- [ ] **Step 7: Rimuovi lo script e committa**

```bash
rm scripts/tmp-e2e-diagnostics.mjs
git add backend/src/routes/diagnostics.js backend/src/server.js
git commit -m "feat(api): rotta diagnostica per l'admin

Espone versione del backend, stato del database e uptime dietro
requireRole('admin'). Serve a riconoscere il caso in cui il servizio
risponde ma è più vecchio dell'app: scarta in silenzio i campi che non
conosce, e il dato non si salva senza che nulla vada in errore.

/api/health resta pubblico e anonimo."
```

---

### Task 2: Frontend — versione dell'app disponibile a runtime

**Files:**
- Modify: `frontend/vite.config.js`

**Interfaces:**
- Produces: costante globale `__APP_VERSION__` (string), disponibile in tutto il codice frontend.

- [ ] **Step 1: Inietta la versione dal package.json**

In `frontend/vite.config.js`, aggiungi in cima al file (dopo gli altri import):

```js
import { readFileSync } from 'node:fs';

// Letto con readFileSync e non con `import ... with { type: 'json' }`: in Node 22
// gli import JSON sono ancora sperimentali e stampano un warning a ogni build.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
```

e dentro l'oggetto passato a `defineConfig({...})`, come proprietà di primo livello
accanto a `plugins`:

```js
  // Versione dell'app leggibile a runtime: serve al badge diagnostico per
  // confrontarla con quella dichiarata dal backend. Presa dal package.json,
  // così resta allineata da sola a ogni release.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
```

- [ ] **Step 2: Verifica che la build inietti il valore**

```bash
rm -f frontend/dist/index.html
npm run build > /tmp/build-version.log 2>&1 &
# attendi che frontend/dist/index.html esista, poi chiudi il processo per PID
grep -rl "1.3.0" frontend/dist/assets/*.js | head -1
```

Atteso: almeno un chunk contiene la stringa di versione. Se `grep` non trova nulla,
`define` non è stato applicato.

- [ ] **Step 3: Commit**

```bash
git add frontend/vite.config.js
git commit -m "build(frontend): esponi __APP_VERSION__ dal package.json"
```

---

### Task 3: Frontend — modulo di raccolta `lib/diagnostics.js`

**Files:**
- Create: `frontend/src/lib/diagnostics.js`
- Modify: `frontend/src/lib/api.js` (esporta `authHeader`)

**Interfaces:**
- Consumes: `getRuntimeConfig()` da `lib/runtime-config.js` (campi `supabaseUrl`, `apiBaseUrl`, `source`, `isSimulator`); `supabase` da `lib/supabase.js`; `__APP_VERSION__` dal Task 2.
- Produces:
  - `collect(): Promise<Diagnostics>` dove `Diagnostics = { backend: { url, ok, latencyMs, version, uptimeS, error }, supabase: { url, ok, latencyMs, error }, environment: { source, isSimulator, appVersion }, session: { role, expiresAt } }`
  - `overallStatus(d: Diagnostics): 'ok' | 'warn' | 'down'`
  - `SLOW_MS` (1500), `TIMEOUT_MS` (5000)

- [ ] **Step 1: Esporta `authHeader` da `api.js`**

In `frontend/src/lib/api.js`, cambia la dichiarazione esistente da:

```js
async function authHeader() {
```

a:

```js
// Esportata perché anche lib/diagnostics.js deve autenticare le proprie
// chiamate, ma senza passare da apiFetch: gli serve lo status code della
// risposta, che apiFetch perde sollevando un'eccezione.
export async function authHeader() {
```

Non toccare altro nel file.

- [ ] **Step 2: Scrivi il modulo**

Crea `frontend/src/lib/diagnostics.js`:

```js
// =====================================================
// Raccolta dati per il badge diagnostico della dashboard admin.
// Nessuna UI: solo sonde e normalizzazione del risultato.
//
// Le sonde di raggiungibilità partono dal CLIENT di proposito: è il punto di
// vista che conta, perché il caso da diagnosticare è "questa copia dell'app non
// raggiunge il servizio", non "il servizio è su" in astratto.
// =====================================================
import { supabase } from './supabase';
import { getRuntimeConfig } from './runtime-config';
import { authHeader } from './api';

export const SLOW_MS = 1500;
export const TIMEOUT_MS = 5000;

/** Host leggibile a partire da un URL completo (per non stampare l'URL intero). */
function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url || '—';
  }
}

/**
 * Sonda del backend: /api/health per la raggiungibilità, poi
 * /api/admin/diagnostics per versione, stato DB e uptime.
 *
 * Il 404 sulla seconda NON è un guasto: significa che il backend è precedente
 * alla versione che ha introdotto la rotta — cioè esattamente il caso che
 * questo badge esiste per rendere visibile.
 */
async function probeBackend() {
  const { apiBaseUrl } = getRuntimeConfig();
  const url = hostOf(apiBaseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = performance.now();

  try {
    const res = await fetch(`${apiBaseUrl}/api/health`, { signal: controller.signal });
    const latencyMs = Math.round(performance.now() - startedAt);
    if (!res.ok) {
      return { url, ok: false, latencyMs, version: null, uptimeS: null, error: `HTTP ${res.status}` };
    }

    // Raggiungibile: ora chiediamo chi è.
    let version = null;
    let uptimeS = null;
    let error = null;
    try {
      const d = await fetch(`${apiBaseUrl}/api/admin/diagnostics`, {
        headers: await authHeader(),
        signal: controller.signal,
      });
      if (d.status === 404) {
        error = 'backend più vecchio dell\'app';
      } else if (!d.ok) {
        error = `diagnostica non disponibile (HTTP ${d.status})`;
      } else {
        const body = await d.json();
        version = body.version ?? null;
        uptimeS = body.uptime_s ?? null;
        if (body.database && body.database.ok === false) {
          error = `database non raggiungibile dal backend${body.database.error ? `: ${body.database.error}` : ''}`;
        }
      }
    } catch (e) {
      error = e.name === 'AbortError' ? 'timeout sulla diagnostica' : e.message;
    }

    return { url, ok: true, latencyMs, version, uptimeS, error };
  } catch (e) {
    const latencyMs = Math.round(performance.now() - startedAt);
    const error = e.name === 'AbortError' ? `nessuna risposta entro ${TIMEOUT_MS / 1000} s` : e.message;
    return { url, ok: false, latencyMs, version: null, uptimeS: null, error };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sonda di Supabase: una query reale invece di un ping, così attraversa rete,
 * chiave anon e RLS — le tre cose che possono davvero rompersi. Un ping HTTP
 * direbbe soltanto che il server è vivo.
 */
async function probeSupabase() {
  const { supabaseUrl } = getRuntimeConfig();
  const url = hostOf(supabaseUrl);
  const startedAt = performance.now();
  try {
    const { error } = await supabase.from('exercises').select('id').limit(1);
    const latencyMs = Math.round(performance.now() - startedAt);
    return { url, ok: !error, latencyMs, error: error ? error.message : null };
  } catch (e) {
    return { url, ok: false, latencyMs: Math.round(performance.now() - startedAt), error: e.message };
  }
}

/** Ambiente e sessione: nessuna chiamata di rete, i dati sono già in memoria. */
async function readEnvironmentAndSession(role) {
  const { source, isSimulator } = getRuntimeConfig();
  let expiresAt = null;
  try {
    const { data } = await supabase.auth.getSession();
    expiresAt = data.session?.expires_at ? new Date(data.session.expires_at * 1000) : null;
  } catch { /* sessione non leggibile: il badge resta utilizzabile */ }

  return {
    environment: { source, isSimulator, appVersion: __APP_VERSION__ },
    session: { role: role ?? null, expiresAt },
  };
}

/**
 * Esegue le sonde in parallelo. `role` arriva dallo store di auth: il modulo non
 * dipende da Pinia, così resta testabile e riusabile.
 */
export async function collect(role) {
  const [backend, supabaseStatus, rest] = await Promise.all([
    probeBackend(),
    probeSupabase(),
    readEnvironmentAndSession(role),
  ]);
  return { backend, supabase: supabaseStatus, ...rest };
}

/**
 * Tre livelli, perché due non distinguono il caso interessante: un servizio
 * raggiungibile ma sbagliato (versione diversa) è il guasto silenzioso.
 */
export function overallStatus(d) {
  if (!d.backend.ok || !d.supabase.ok) return 'down';
  const versionMismatch =
    !d.backend.version || d.backend.version !== d.environment.appVersion;
  const slow = d.backend.latencyMs > SLOW_MS || d.supabase.latencyMs > SLOW_MS;
  if (versionMismatch || slow || d.backend.error) return 'warn';
  return 'ok';
}
```

- [ ] **Step 3: Verifica che la build non si rompa**

```bash
rm -f frontend/dist/index.html
npm run build > /tmp/build-diag.log 2>&1 &
# attendi frontend/dist/index.html, poi chiudi per PID
grep -E "built in|error" /tmp/build-diag.log
```

Atteso: `✓ built in ...`, nessun errore. `__APP_VERSION__` non deve risultare
"is not defined": se succede, il Task 2 non è stato applicato.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/diagnostics.js frontend/src/lib/api.js
git commit -m "feat(frontend): modulo di raccolta per la diagnostica

Sonde verso backend e Supabase più lettura di ambiente e sessione, senza
UI. Supabase si verifica con una query reale e non con un ping: così si
attraversano rete, chiave anon e RLS.

Le chiamate non passano da apiFetch perché serve lo status code, che
apiFetch perde sollevando un'eccezione: il 404 su /api/admin/diagnostics
significa 'backend più vecchio dell'app' e va distinto da un guasto."
```

---

### Task 4: Frontend — componente badge e montaggio nella dashboard

**Files:**
- Create: `frontend/src/components/ServiceStatusBadge.vue`
- Modify: `frontend/src/views/admin/DashboardView.vue` (import + montaggio sopra `IdentityCard`)

**Interfaces:**
- Consumes: `collect(role)`, `overallStatus(d)` da `lib/diagnostics.js`; `useAuthStore()` da `stores/auth.js`.

- [ ] **Step 1: Scrivi il componente**

Crea `frontend/src/components/ServiceStatusBadge.vue`:

```vue
<script setup>
// Badge diagnostico della dashboard admin: collassato mostra un pallino e
// l'ambiente, espanso i dettagli. Vive solo nella dashboard admin, che è già
// riservata per ruolo: la protezione vera sta sulla rotta backend.
import { ref, computed, onMounted } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { collect, overallStatus } from '@/lib/diagnostics';

const auth = useAuthStore();
const data = ref(null);
const loading = ref(true);
const expanded = ref(false);

async function refresh() {
  loading.value = true;
  try {
    data.value = await collect(auth.role);
  } finally {
    loading.value = false;
  }
}

onMounted(refresh);

const status = computed(() => (data.value ? overallStatus(data.value) : null));

const dotClass = computed(() => ({
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  down: 'bg-rose-500',
}[status.value] || 'bg-gray-300'));

const summary = computed(() => {
  if (!data.value) return 'Verifica in corso…';
  const env = data.value.environment.source === 'sim' ? 'Locale' : 'Cloud';
  const label = { ok: 'servizi ok', warn: 'da controllare', down: 'servizio non raggiungibile' }[status.value];
  return `${env} · ${label}`;
});

function fmtMs(ms) {
  return ms == null ? '—' : `${ms} ms`;
}

function fmtUptime(s) {
  if (s == null) return '—';
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
}

function fmtExpiry(date) {
  if (!date) return '—';
  return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}
</script>

<template>
  <section class="rounded-2xl bg-white p-4 shadow-sm">
    <button
      type="button"
      class="flex w-full items-center gap-2 text-left"
      @click="expanded = !expanded"
    >
      <span class="h-2.5 w-2.5 shrink-0 rounded-full" :class="dotClass"></span>
      <span class="flex-1 text-sm font-medium text-gray-900">{{ summary }}</span>
      <span v-if="data" class="text-xs text-gray-400">v{{ data.environment.appVersion }}</span>
      <span class="text-xs text-gray-400">{{ expanded ? '⌃' : '⌄' }}</span>
    </button>

    <div v-if="expanded && data" class="mt-3 space-y-3 border-t border-gray-100 pt-3 text-xs">
      <!-- Backend -->
      <div>
        <div class="flex items-center justify-between">
          <span class="font-semibold text-gray-700">Backend</span>
          <span :class="data.backend.ok ? 'text-emerald-600' : 'text-rose-600'">
            {{ data.backend.ok ? 'ok' : 'non raggiungibile' }} · {{ fmtMs(data.backend.latencyMs) }}
          </span>
        </div>
        <p class="text-gray-400">{{ data.backend.url }}</p>
        <p class="text-gray-500">
          versione {{ data.backend.version || '—' }} · attivo da {{ fmtUptime(data.backend.uptimeS) }}
        </p>
        <p v-if="data.backend.error" class="text-amber-700">⚠️ {{ data.backend.error }}</p>
      </div>

      <!-- Supabase -->
      <div>
        <div class="flex items-center justify-between">
          <span class="font-semibold text-gray-700">Supabase</span>
          <span :class="data.supabase.ok ? 'text-emerald-600' : 'text-rose-600'">
            {{ data.supabase.ok ? 'ok' : 'non raggiungibile' }} · {{ fmtMs(data.supabase.latencyMs) }}
          </span>
        </div>
        <p class="text-gray-400">{{ data.supabase.url }}</p>
        <p v-if="data.supabase.error" class="text-rose-600">{{ data.supabase.error }}</p>
      </div>

      <!-- Ambiente e sessione -->
      <div class="flex justify-between text-gray-500">
        <span>
          Ambiente
          {{ data.environment.source === 'sim' ? 'locale' : 'cloud' }}
          <template v-if="data.environment.isSimulator">(simulatore)</template>
        </span>
        <span>{{ data.session.role || '—' }} · scade {{ fmtExpiry(data.session.expiresAt) }}</span>
      </div>

      <button
        type="button"
        class="ml-auto block font-semibold text-brand active:scale-95"
        :disabled="loading"
        @click.stop="refresh"
      >
        {{ loading ? 'Verifico…' : 'Aggiorna' }}
      </button>
    </div>
  </section>
</template>
```

- [ ] **Step 2: Montalo nella dashboard admin**

In `frontend/src/views/admin/DashboardView.vue`, aggiungi l'import accanto a quello di
`IdentityCard`:

```js
import ServiceStatusBadge from '@/components/ServiceStatusBadge.vue';
```

e nel template, come **primo** figlio di `<div class="space-y-5">`, sopra `<IdentityCard />`:

```html
    <ServiceStatusBadge />
```

- [ ] **Step 3: Verifica la build**

```bash
rm -f frontend/dist/index.html
npm run build > /tmp/build-badge.log 2>&1 &
# attendi frontend/dist/index.html, poi chiudi per PID
grep -E "built in|error" /tmp/build-badge.log
grep -rl "servizi ok" frontend/dist/assets/*.js | head -1
```

Atteso: build riuscita e la stringa del badge presente in un chunk.

- [ ] **Step 4: Verifica nel browser con lo stack locale**

```bash
npm run db:start          # se non già attivo
node backend/src/server.js & SVPID=$!
npm run dev:fe
```

Accedi come `admin@gym.local` / `password123` e controlla sulla dashboard:
1. il badge appare in cima, con pallino **verde** e testo tipo `Locale · servizi ok`;
2. espandendolo si vedono i due host, le latenze, la versione del backend e la
   sessione;
3. `Aggiorna` rilancia le sonde senza ricaricare la pagina;
4. **prova il caso rosso**: `kill $SVPID`, poi `Aggiorna` → il backend deve risultare
   `non raggiungibile` con pallino rosso, e il blocco Supabase deve restare verde
   (le sonde sono indipendenti);
5. riavvia il backend e verifica che torni verde.

- [ ] **Step 5: Verifica sul device**

```bash
UDID=$(xcrun devicectl list devices | awk '/available \(paired\)/ {print $3; exit}')
DD=/tmp/gym-dd                    # derivedDataPath, per sapere dove finisce App.app

npm run build                     # attendi dist/index.html, chiudi per PID
npx cap sync ios                  # attendi ios/App/App/public/index.html, chiudi per PID
xcodebuild -workspace frontend/ios/App/App.xcworkspace -scheme App \
  -configuration Debug -destination "id=$UDID" -derivedDataPath $DD \
  -allowProvisioningUpdates build
xcrun devicectl device install app --device $UDID $DD/Build/Products/Debug-iphoneos/App.app
xcrun devicectl device process launch --device $UDID --console local.gym.app
```

Se il lancio fallisce con `FBSOpenApplicationErrorDomain error 7`, l'iPhone è bloccato:
l'installazione è comunque riuscita, basta sbloccarlo e rilanciare.

Atteso sul device: ambiente **cloud**, host `52-49-165-160.sslip.io` e
`nayiujdfvevccoluqwic.supabase.co`, latenze reali.

⚠️ Finché il Task 1 non è deployato in produzione, il badge mostrerà **giallo** con
«backend più vecchio dell'app»: è il comportamento corretto, ed è la conferma sul campo
che la rilevazione funziona.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ServiceStatusBadge.vue frontend/src/views/admin/DashboardView.vue
git commit -m "feat(admin): badge stato servizi nella dashboard

Collassato mostra ambiente e stato con un pallino; espanso host, latenze,
versione del backend a confronto con quella dell'app, uptime e sessione.

Tre livelli e non due: il giallo copre il caso in cui tutto risponde ma
qualcosa non torna — versione diversa o latenza oltre 1500 ms — che è il
guasto che altrimenti non si manifesta."
```

---

### Task 5: Aggiorna il CHANGELOG

**Files:**
- Modify: `CHANGELOG.md` (sezione `[Non rilasciato]`)

- [ ] **Step 1: Aggiungi la voce**

Sotto `## [Non rilasciato]`, nella sottosezione `### Aggiunto` (creala se assente):

```markdown
- **Badge stato servizi** nella dashboard admin: ambiente attivo (cloud o locale), stato
  e latenza di backend e Supabase, versione del backend a confronto con quella dell'app,
  uptime del servizio e scadenza della sessione. Tre livelli — verde, giallo, rosso —
  dove il giallo segnala il caso in cui tutto risponde ma le versioni non combaciano: è
  il guasto che non si manifesta da sé, perché un backend più vecchio scarta in silenzio
  i campi che non conosce.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog del badge stato servizi"
```

---

## Note di rilascio

La rotta `/api/admin/diagnostics` fa parte del backend: finché la release non è
deployata, in produzione risponde 404 e il badge mostra giallo. Al momento del deploy
**non servono migration** — nessuna modifica allo schema — quindi basta il merge su
`master`, che fa scattare la GitHub Action.
