# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Web app mobile-first per la gestione di una palestra. Monorepo npm workspaces: `frontend/` (Vue 3), `backend/` (Fastify), `supabase/` (migrations). Tre ruoli: **admin**, **trainer**, **member**.

## Comandi

```bash
npm install            # installa root + entrambi i workspace

# Database locale (richiede Docker attivo)
npm run db:start       # supabase start — applica le migration
npm run db:status      # URL + chiavi locali
npm run db:reset       # ricrea il DB da zero riapplicando le migration
npm run db:stop
npm run seed           # dati demo (admin/trainer/member@gym.local, pwd password123)

# Sviluppo (in due terminali)
npm run dev:be         # Fastify su :3000  (health: /health)
npm run dev:fe         # Vite su :5173

npm run build          # build di produzione del frontend
npm run db:push        # applica le migration al progetto Supabase CLOUD (produzione)
```

**Due ambienti Supabase**: in locale gira l'istanza CLI/Docker; in **produzione** si usa
**Supabase Cloud** (free tier) — l'EC2 ospita solo backend + Caddy. Cambiano solo i `.env`
(`*.env.production.example`), il codice è identico. Le migration locali si applicano con
`db:reset`, quelle remote con `db:push` (la CLI traccia da sé cosa è già applicato).

Non esistono test unitari configurati: la verifica si fa con **script e2e usa-e-getta** che accedono a Supabase locale via `@supabase/supabase-js` (login utenti seed → chiamate REST al backend). Pattern usato: creare un file `.mjs` temporaneo, avviare il backend, eseguirlo, poi rimuoverlo.

### Ambiente / gotcha
- **Docker** serve solo per Supabase; il codice si scrive/builda senza. La CLI Supabase (`supabase`) è una devDependency della root → invocarla con `npx supabase` o via script `db:*`.
- La shell dell'agente **non è nel gruppo `docker`** di default: prefissare i comandi Supabase con `sg docker -c "..."`.
- ⚠️ **Non usare `pkill`/`pgrep -f "backend/src/server.js"`**: il pattern matcha la riga di comando della shell stessa → auto-SIGTERM (exit 144, nessun output). Avviare il server con `node backend/src/server.js & SVPID=$!` e uccidere per PID.
- **Node ≥ 22 obbligatorio**: `@supabase/supabase-js` usa la WebSocket nativa, assente in Node 20 → il backend va in crash-loop all'avvio. Vite 8 richiede `@vitejs/plugin-vue` v6+.

## Architettura

### Sicurezza a due livelli (chiave del progetto)
1. **Backend Fastify** con `service_role` key (`backend/src/lib/supabase.js` → `supabaseAdmin`) che **bypassa la RLS**; l'autorizzazione è fatta esplicitamente nelle rotte via i decorator `authenticate` + `requireRole(...)` di `backend/src/plugins/auth.js`. Usare `supabaseAdmin` per operazioni che richiedono di vedere righe di più utenti (es. conteggio capacità corsi, lista utenti).
2. **RLS Postgres** come difesa finale. Le policy usano la funzione `SECURITY DEFINER` `public.current_user_role()` per leggere il ruolo senza ricorsione. Il **frontend** usa la `anon` key (`frontend/src/lib/supabase.js`) e legge direttamente da Supabase per i dati coperti da RLS (profilo, schede, catalogo esercizi), mentre chiama il backend per la logica applicativa.

Regola pratica: **letture protette da RLS** → client Supabase diretto dal frontend; **scritture/logica** (capacità, ruoli, report) → backend Fastify via `frontend/src/lib/api.js`.

### Autenticazione
Supabase Auth. Un trigger DB (`handle_new_user`) crea automaticamente una riga `profiles` a ogni signup, con ruolo dai metadati (`raw_user_meta_data.role`, default `member`). Il ruolo dell'utente sta in `profiles.role`, non nel JWT.

### Backend (`backend/src/`)
- `server.js` — bootstrap: carica env (via `lib/env.js`, path esplicito a `backend/.env` a prescindere dalla cwd), registra il plugin auth e tutte le rotte.
- `plugins/auth.js` — verifica il Bearer JWT con `supabaseAdmin.auth.getUser()`, carica `request.user`/`request.userRole`; espone `authenticate` e `requireRole(...ruoli)`.
- `routes/*.js` — un file per risorsa: `classes`, `bookings` (con controllo capacità + anti-doppione), `workouts`, `exercises`, `members` (include `/api/users` admin), `reports`, `sessions`. Le rotte che devono verificare la proprietà di una riga (es. `sessions`) lo fanno esplicitamente perché `supabaseAdmin` bypassa la RLS.

### Frontend (`frontend/src/`)
- Vue 3 `<script setup>`, Pinia, Vue Router, TailwindCSS mobile-first. Alias `@` → `src`.
- `main.js` ripristina la sessione (`authStore.init()`) **prima** di montare, così le guardie del router conoscono lo stato di login.
- `stores/auth.js` — sessione, `role`, `isSubscriptionActive`, login/register/logout.
- `router/index.js` — area protetta sotto `layouts/AppLayout.vue` (header + `components/BottomNav.vue`); guardie su `meta.requiresAuth` e `meta.roles`.
- **Navigazione role-aware**: `views/HomeDispatcher.vue` sceglie la dashboard (member/trainer/admin) e `BottomNav` cambia le tab in base al ruolo. L'admin oggi non ha una dashboard member: le viste sono divise in `views/{member,trainer,admin}/`.
- `lib/api.js` — wrapper fetch verso il backend con JWT automatico. **Nota**: imposta `Content-Type: application/json` solo se c'è un body (Fastify risponde 400 a un body JSON vuoto, es. DELETE senza payload).
- `lib/storage.js` — upload immagini esercizi e URL pubblici dal bucket Storage.

### Modello dati (`supabase/migrations/`)
Le migration sono append-only ma in dev locale si riapplicano con `db:reset`. Tabelle: `profiles`, `classes`, `bookings`, `workouts`, `exercises`, `workout_sessions`.
- **Esercizi** (`exercises`): catalogo di *tipi* di esercizio con immagine e descrizione **condivise per tipo** (single source of truth). Immagini nel bucket Storage pubblico `exercise-images` (upload consentito solo a trainer/admin via policy su `storage.objects`). `load_type` (`weight`|`level`) decide se durante l'allenamento si registra il peso in kg o il livello di difficoltà. Campi opzionali: `muscle_group`, `video_url` (link esecuzione, es. YouTube).
- **Schede** (`workouts`): entità con `title` e `days_json` = giornate, ognuna con esercizi che referenziano il catalogo: `[{ name, exercises: [{ exercise_id, sets, reps, rest_seconds }] }]`. Un member può avere più schede.
- **Sessioni** (`workout_sessions`): il member "inizia un allenamento" scegliendo scheda + giornata; la sessione fa uno **snapshot** della giornata così storico e calendario restano corretti anche se la scheda cambia. `exercises_log` = `[{ exercise_id, target_reps, rest_seconds, load_type, sets_log: [{ reps, load, done, done_at }] }]`: una riga per serie con reps effettuate e carico (kg o livello). All'avvio (`POST /api/sessions`) il backend **precompila i carichi** dall'ultima sessione completata che conteneva lo stesso esercizio. `completed_at` null = in corso. Il timer di recupero per serie è solo lato client (SessionView).

Modificando lo schema: creare una nuova migration, aggiornare lo `schema` di validazione nella rotta backend corrispondente, il `scripts/seed.mjs`, e le viste che leggono quei campi.
