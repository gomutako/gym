# Migrazione a Cloudflare + Supabase + Resend su pallade.it — Implementation Plan

> **For agentic workers:** i task usano checkbox (`- [ ]`). Le fasi sono sequenziali:
> la Fase 1 è un **prerequisito di sicurezza non negoziabile** per la Fase 4.

**Goal:** eliminare l'EC2 e ogni componente non necessario, portando l'app su tre servizi
gestiti a costo zero — **Cloudflare Pages** (statico), **Supabase** (DB, Auth, Storage,
Edge Functions), **Resend** (posta) — sotto il dominio **pallade.it**.

> **Aggiornamento del 2026-07-27 (a lavori in corso):** l'utente ha dichiarato che **non
> interessa più preservare il funzionamento dell'app iOS già installata**. Cade quindi tutta
> la compatibilità transitoria: `deploy/`, `terraform/`, il vhost sslip.io e l'attesa del
> Mac prima di smantellare. L'EC2 va terminato (con l'Elastic IP) alla prima occasione.

**Priorità dichiarata:** l'**app iOS** è il prodotto. Il **web serve solo come banco di
prova e uso personale**. Questo cambia le priorità: l'hosting statico esiste soprattutto
per gli **universal link** e per le pagine pubbliche che l'App Store richiederà, non per
servire utenti web. Nessuna ottimizzazione web (SEO, Core Web Vitals, prerender) è in scopo.

**Topologia di arrivo:**

```text
pallade.it            → Cloudflare Pages (SPA + .well-known/, nessuna function)
*.supabase.co         → Postgres + RLS + Auth + Storage + 2 Edge Functions
send.pallade.it       → Resend (SMTP di Supabase Auth)
GitHub Actions        → build/deploy Pages + pg_dump schedulato
app iOS               → bundle statico che parla diretto a Supabase
```

Spariscono: EC2, Elastic IP, Caddy, systemd, `backend/`, `deploy/`, `deploy.yml`,
`sslip.io`, `CORS_ORIGIN` come variabile d'ambiente, `lib/api.js`.

---

## Global Constraints

- **Le migration in cloud si applicano dal SQL Editor del dashboard**, non con `db push`:
  da WSL `db push` falla perché `db.<ref>.supabase.co` ha solo record AAAA (IPv6). Dopo
  aver incollato l'SQL, registrare la versione:
  `insert into supabase_migrations.schema_migrations (version) values ('<timestamp>');`
  In locale invece vale `npm run db:reset`. Ref progetto: `nayiujdfvevccoluqwic`.
- **Ordine obbligato**: migration in cloud **prima** del codice che le usa. Un client
  vecchio ignora in silenzio i campi che non conosce → il dato non si salva e nessuno
  segnala un errore.
- Nessun framework di test: la verifica si fa con **script e2e usa-e-getta** (`.mjs`
  temporanei che fanno login con gli utenti seed e chiamano Supabase/REST), rimossi dopo
  l'uso. Non introdurre Jest/Vitest.
- ⚠️ Non usare `pkill`/`pgrep -f "backend/src/server.js"`: il pattern matcha la shell
  stessa. Avviare con `node backend/src/server.js & SVPID=$!` e uccidere per PID.
- ⚠️ `vite build` e `npx cap sync ios` non terminano da soli: verificare l'artefatto
  (`frontend/dist/index.html`, `frontend/ios/App/App/public/index.html`) e chiudere per
  PID. Non usare `| tail`: la pipe bufferizza. Redirigere su file di log.
- **Ogni modifica al frontend richiede** `npm run build` + `npx cap sync ios` + reinstallo
  sul device. Nessuna modifica arriva all'app iOS senza questo ciclo.
- Utenti seed: `admin@gym.local`, `trainer@gym.local`, `member@gym.local`, `password123`.
- Testo utente in **italiano**. Enum DB in italiano (i nomi degli esercizi restano inglesi).
- Node ≥ 22. Dopo ogni `npm install <pacchetto>` rieseguire `npm install` nudo dalla root
  (npm pota il binding Rolldown e `vite build` resta appeso senza output).

---

## Ripartizione fra le due macchine

Si lavora su **WSL/Linux** (macchina principale) e su un **Mac** per la parte iOS. Conviene
accorpare i task Mac invece di alternare.

**Da fare su WSL (o indifferentemente):** tutta la Fase 1 (SQL + e2e), tutta la Fase 2
(DNS/dashboard/file — Pages builda sui propri runner, non serve build locale), il codice di
Fase 3.1 e 3.4, tutto il codice di Fase 4 con verifica **sul web** (`npm run dev:fe` +
Supabase locale), tutta la Fase 5.

**Da fare sul Mac (accorpabili in una sessione):**

- 3.2 entitlement `associated-domains` + verifica che il link apra davvero l'app
- 3.3 bundle id → nuovo provisioning profile generato da Xcode + reinstallo
- 4.x le verifiche sul **device fisico** a ogni gruppo (`npm run build` +
  `npx cap sync ios` + `xcodebuild` + `devicectl`)
- il rilascio finale prima di spegnere l'EC2 (Fase 5.3)

**Gotcha specifici del Mac:**

- 🚨 Il progetto **non deve stare in una cartella sincronizzata con iCloud** (`~/Desktop`,
  `~/Documenti` con "Cartelle Desktop e Documenti" attivo): corrompe `node_modules` e
  `.git` in modi fuorvianti. Clonare in `~/Developer`.
- `sg docker -c "..."` serve **solo su Linux**: su macOS `sg` non esiste, i comandi
  Supabase si lanciano diretti.
- `supabase/.temp/` è gitignorato → sul Mac serve
  `npx supabase link --project-ref nayiujdfvevccoluqwic` prima di qualsiasi `db push`.
- Il blocco IPv6 di `db push` **è specifico di WSL**: da macOS con IPv6 funzionante
  `npx supabase db push` può andare normalmente. Verificarlo con
  `npx supabase migration list --linked`; se funziona, sul Mac si può usare la CLI invece
  del SQL Editor (registrando comunque nulla a mano — la CLI traccia da sé).
- ⚠️ `ps | grep | kill` si auto-matcha quando la shell sta eseguendo il comando cercato
  (es. `cap sync ios`): filtrare con `awk '/pattern/ && !/zsh/ && !/awk/ {print $1}'`.

---

## Fase 0 — Punto di non ritorno: decisione sul backend

Due strade. La Fase 4 (smantellamento) è la più aderente all'obiettivo "abbandonare il
superfluo", ma è anche il 70% del lavoro totale.

- **Strada A (raccomandata, questo piano):** il backend sparisce. Le rotte diventano RLS +
  trigger + 2 Edge Functions. Dall'analisi: ~90% delle 1562 righe di `backend/src` sono
  wrapper CRUD che duplicano policy RLS già esistenti.
- **Strada B (ponte, se vuoi l'EC2 spento entro pochi giorni):** dopo la Fase 2, sposti il
  Fastify così com'è su un PaaS free (Fly.io/Render) puntandogli `api.pallade.it`, spegni
  l'EC2 subito, e affronti la Fase 4 quando ti va. Costo: ~2 ore, zero righe di logica
  toccate, un componente in più che resta in vita.

- [x] Scegliere A o B e annotarlo qui prima di procedere.
      → **Strada A** scelta il 2026-07-27: il backend viene smantellato. Si lavora da WSL
      fino al limite del possibile, poi si passa al Mac per il ciclo build/install su iPhone.

---

## Fase 1 — Messa in sicurezza della RLS (prerequisito)

**Perché prima di tutto:** oggi la RLS è la *seconda* difesa e il backend è la prima.
Togliendo il backend, la RLS diventa **l'unica**. Ha almeno un buco già sfruttabile adesso.

**Files:** `supabase/migrations/20260727120000_rls_hardening.sql` (creata),
`scripts/tmp-e2e-rls.mjs`, `scripts/tmp-e2e-backend-smoke.mjs`,
`scripts/tmp-preflight-cloud.mjs` (usa-e-getta — **non committare**, rimuovere dopo 1.7)

> **Stato: codice completo e verificato in locale.** 25/25 asserzioni dell'e2e ostile,
> 19/19 dello smoke del backend. Resta da applicare al cloud (1.7).

- [x] **1.1 — Escalation di privilegio su `profiles` (grave, già sfruttabile).**
  `profiles_update_self` ([20260724130000_profile_fields.sql:19](../../../supabase/migrations/20260724130000_profile_fields.sql#L19))
  consente al member di aggiornare *tutta* la propria riga, `role` compreso. Con la anon
  key (pubblica nel bundle) e un login member qualsiasi si può chiamare PostgREST diretto
  e diventare `admin`, oppure allungarsi `subscription_end_date`. Il backend non protegge
  nulla perché non è sulla strada obbligata.
  Rimedio: trigger `BEFORE UPDATE` su `profiles` che rifiuta variazioni di `role` e
  `subscription_end_date` se `public.current_user_role() <> 'admin'`. Preferire il trigger
  ai grant per colonna, così la regola resta leggibile in un posto solo.
- [x] **1.2 — `workouts_write` troppo larga.** `with check (role in ('admin','trainer'))`
  permette a un trainer di modificare o cancellare le schede create da altri trainer.
  Restringere a `trainer_id = auth.uid() or current_user_role() = 'admin'`.
- [x] **1.3 — Capacità corsi in un trigger.** Il controllo in
  [bookings.js:82-95](../../../backend/src/routes/bookings.js#L82-L95) conta-poi-inserisce
  senza lock: due prenotazioni concorrenti passano entrambe. Sostituire con un trigger
  `BEFORE INSERT` su `bookings` che fa `select ... for update` sulla riga di `classes` e
  solleva se `count >= max_capacity`. **Risolve un bug esistente**, non solo la migrazione.
- [x] **1.4 — Constraint al posto degli schema JSON di Fastify.** Realizzati come *trigger*
  e non come CHECK: messaggio d'errore in italiano, nessuna dipendenza funzione→constraint
  che possa inciampare nel restore di un `pg_dump` (rilevante per il backup della Fase 5),
  e le righe esistenti non vengono rivalidate. Sparita la validazione
  Fastify, il DB deve difendersi: `check (end_date >= start_date)` su `subscriptions`;
  validazione della forma di `days_json` e `exercises_log` (funzione + `check`, o almeno
  `jsonb_typeof = 'array'`); enum già presenti verificati.
- [x] **1.5 — Restringere i grant.** [init.sql:127-129](../../../supabase/migrations/20260723120000_init.sql#L127-L129)
  fa `grant all on all tables ... to anon`. Ridurre `anon` al minimo (serve solo per il
  login) e lasciare i privilegi a `authenticated`/`service_role`.
- [x] **1.6 — e2e ostile.** Script che, con la **anon key** e un JWT member, prova a:
  farsi admin, allungarsi l'abbonamento, leggere le schede di un altro member, prenotare
  un corso pieno, modificare la scheda di un altro trainer, inserire un `days_json`
  malformato. Ogni tentativo **deve** fallire. Girare in locale (`db:reset`), poi in cloud.
- [x] **1.7 — Applicare in cloud.** ✅ applicata il 2026-07-27 dal SQL Editor (transazione
  unica con la registrazione della versione). Verificata con e2e ostile **solo-attacchi**
  contro il cloud: **16/16 respinti**, compresa la lettura incrociata verso il member reale;
  produzione ripulita (3 profili, nessun residuo). Vedi `scripts/tmp-e2e-rls-cloud.mjs`. Non più a mano: usare la CLI, che registra da sé la
  versione in `supabase_migrations.schema_migrations`. Serve la password del DB
  (Dashboard → Database → Connection string → **Session pooler**, IPv4 — l'host diretto
  `db.<ref>.supabase.co` ha solo record AAAA e da WSL non si raggiunge).
  - da WSL: `export SUPABASE_DB_URL="…"` poi `npm run db:push:dry` e `npm run db:push`
  - oppure senza toccare la rete locale: workflow **DB migrate** su GitHub Actions
    (`.github/workflows/db-migrate.yml`, `workflow_dispatch`), secret `SUPABASE_DB_URL`
  - dal Mac, se l'IPv6 funziona: `npm run db:push` basta con il progetto collegato
  - SQL Editor solo come ripiego d'emergenza (ricordando l'`insert` della versione)

**Verifica:** 6/6 tentativi respinti in locale e in cloud; l'app iOS esistente continua a
funzionare (nessun cambio di contratto lato client in questa fase).

---

## Fase 2 — Dominio, DNS, hosting statico

Nessun cambio di logica applicativa. Da qui `sslip.io` esce di scena.

- [ ] **2.1 — pallade.it su Cloudflare.** Nameserver del registrar → Cloudflare. Verificare
  la propagazione prima di procedere.
- [ ] **2.2 — Cloudflare Pages** collegato al repo GitHub, branch `master`:
  build `npm install && npm run build --workspace frontend`, output `frontend/dist`,
  Node 22. Custom domain `pallade.it` (+ `www` redirect se vuoi).
  - SPA fallback: Pages serve `index.html` sui path non trovati (`404.html`/`_redirects`
    se serve esplicitarlo) — verificare che `https://pallade.it/training` non dia 404.
  - **Attenzione al service worker**: il frontend ha `vite-plugin-pwa` con
    `registerType: 'autoUpdate'` ([vite.config.js:15](../../../frontend/vite.config.js#L15)).
    Verificare che `sw.js` e il manifest siano serviti con cache corta (`_headers`),
    altrimenti resta appiccicata una versione vecchia.
- [ ] **2.3 — Le variabili di build su Pages.** `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY` (produzione cloud). Le `*_SIM` **non** vanno su Pages: servono
  solo alla build locale per il simulatore.
- [ ] **2.4 — Resend: verifica dominio.** Usare il sottodominio **`send.pallade.it`** per
  non toccare gli MX di `pallade.it` (se un giorno vuoi caselle vere). SPF + DKIM come da
  Resend, e un record **DMARC** su `pallade.it`. Sender `noreply@pallade.it`.
- [ ] **2.5 — Supabase Auth.** Site URL `https://pallade.it`. Redirect URLs:
  `https://pallade.it/**` **e** `capacitor://localhost/**` (senza il secondo il reset
  dentro l'app non torna indietro). Verificare che il **rate limit email di Auth** sia
  alzato: è indipendente da Resend, e al default basso throttla i reset password.
- [ ] **2.6 — Template email di Auth** tradotti in italiano e brandizzati Pallade (ora
  sono i default in inglese). Il contenuto del link cambia nella Fase 3: qui solo la veste.
- [x] **2.7 — Aggiornare i riferimenti nel repo** (fatto il 2026-07-27): esempi env con
  `CORS_ORIGIN` e segnaposto `app.tuodominio.com` sostituiti in `DEPLOY.md`; `HANDOVER.md`
  con dominio, Resend e avviso di migrazione.
  **Rettifica del 2026-07-27**: l'`api.pallade.it` previsto qui è stato eliminato — serviva
  a esporre il Fastify durante la transizione, ma il backend è stato smantellato prima
  (Fase 4.10), quindi non c'è nulla da esporre. `deploy/Caddyfile` ha il solo vhost sslip.
  ⚠️ Se un record `pallade.it`/`www`/`api` punta all'EC2, Cloudflare risponde **525**:
  quel Caddy ha certificati solo per l'hostname sslip.io. ⚠️ I `.env.production` **reali** non sono
  stati toccati: si cambiano al momento del cutover, e sslip va rimosso solo dopo aver
  ricostruito l'app iOS.
  Riferimenti originali: `frontend/.env.production`,
  `backend/.env.production` (`CORS_ORIGIN=https://pallade.it,capacitor://localhost`),
  i tre `.env.*.example`, [deploy/Caddyfile:12](../../../deploy/Caddyfile#L12),
  `HANDOVER.md`, `DEPLOY.md`.

**Verifica:** `https://pallade.it` serve l'app con certificato valido; un deep link diretto
non dà 404; un reset password inviato arriva da `noreply@pallade.it` e passa SPF/DKIM
(controllare gli header nel client mail o su mail-tester).

---

## Fase 3 — Email, universal link, identità dell'app

Qui si sistema un flusso **oggi rotto sull'app iOS** e si chiude la finestra sul bundle id.

- [x] **3.1 — Link di reset sul tuo dominio.** ✅ verificato e2e leggendo l'email da Mailpit (10/10). Oggi `redirectTo: window.location.origin`
  ([auth.js:100](../../../frontend/src/stores/auth.js#L100)) vale `capacitor://localhost`
  dentro l'app: il link nell'email punta a `capacitor://localhost/reset-password`, che
  **nessun client mail iOS apre**. Chi chiede il reset dal telefono resta bloccato.
  Rimedio: template Auth che costruisce il link con `{{ .TokenHash }}` verso
  `https://pallade.it/reset-password?token_hash=...&type=recovery`, e
  [ResetPasswordView.vue](../../../frontend/src/views/ResetPasswordView.vue) che chiama
  `supabase.auth.verifyOtp({ token_hash, type: 'recovery' })` invece di aspettare la
  sessione dal redirect. Effetto collaterale gradito: il click resta su pallade.it, quindi
  niente mismatch "email da pallade.it → link a supabase.co" (che sa di phishing) e nessun
  bisogno del Custom Domain add-on da $10/mese.
- [x] **3.2 — Universal link.** File creato con Team ID reale `7M9683Z95M` + entitlement `applinks:pallade.it`; `_headers` forza `application/json`. Da provare sul device. File `apple-app-site-association` (senza estensione,
  `Content-Type: application/json`) servito da `https://pallade.it/.well-known/`:
  metterlo in `frontend/public/.well-known/` così Vite lo copia in `dist`. Aggiungere
  l'entitlement `com.apple.developer.associated-domains` = `applinks:pallade.it` in Xcode.
  Così il link del reset apre **l'app**, non Safari.
- [x] **3.3 — Bundle id `local.gym.app` → `it.pallade.app`.** ✅ fatto (capacitor.config.ts + 2 occorrenze in project.pbxproj). Richiede nuovo provisioning dal Mac. ⚠️ **Da fare adesso o mai
  più**: dopo la prima pubblicazione su App Store non è modificabile (sarebbe un'app
  nuova). Toccare [capacitor.config.ts:4](../../../frontend/capacitor.config.ts#L4) e i due
  `PRODUCT_BUNDLE_IDENTIFIER` in `frontend/ios/App/App.xcodeproj/project.pbxproj`.
  Conseguenze: nuovo provisioning profile (rigenerato da Xcode), **l'app va reinstallata**
  sul device (i dati locali si perdono), e i comandi con `local.gym.app` in `CLAUDE.md` e
  nei piani vecchi vanno aggiornati.
- [x] **3.4 — `appName`** da `Gym` a `Pallade` in `capacitor.config.ts` + display name iOS.

**Verifica:** dal device, "password dimenticata" → l'email arriva, il tap sul link **apre
l'app** sulla schermata di reset, la nuova password funziona. Provare anche dal web.

---

## Fase 4 — Smantellamento del backend (solo Strada A)

Rotta per rotta, dalla più innocua alla più delicata. **Dopo ogni gruppo**: e2e usa-e-getta,
`npm run build`, `npx cap sync ios`, prova sul device. Non accorpare i gruppi.

- [x] **4.1 — Letture pure → client Supabase diretto.** Sostituire in `lib/api.js` →
  `supabase.from(...)`: `GET /api/profile`, `/api/subscriptions/member/:id`,
  `/api/templates`, `/api/classes`, `/api/sessions`, `/api/sessions/:id`,
  `/api/bookings`, `/api/workouts/member/:id`, `/api/exercises`. Sono tutte già coperte da
  policy `select` equivalenti.
- [x] **4.2 — Scritture semplici → client diretto.** `PATCH /api/profile` (attenzione:
  `full_name` è generata, si scrivono `first_name`/`last_name`), `POST/DELETE
  /api/subscriptions`, CRUD `/api/templates`, CRUD `/api/classes`, CRUD `/api/exercises`,
  `PATCH /api/workouts/:id/active|archived`, `PATCH /api/sessions/:id`.
- [x] **4.3 — Prenotazioni.** `POST /api/bookings` diventa un insert diretto: la capacità
  la fa il trigger della Fase 1.3, il doppione il vincolo UNIQUE. Mappare i codici errore
  Postgres a messaggi italiani lato client (`23505` → "Sei già prenotato", errore del
  trigger → "Corso al completo").
- [x] **4.4 — Prefill dei carichi.** La logica in
  [sessions.js:80-96](../../../backend/src/routes/sessions.js#L80-L96) legge **solo dati
  del member stesso**, già leggibili via RLS → spostarla nel client, dentro un
  `lib/sessions.js`. Include lo snapshot della giornata e i metadati `load_type`/
  `has_incline` dal catalogo.
- [x] **4.5 — Assegnazione template.** `POST /api/templates/:id/assign` è una lettura +
  un insert in `workouts` che il trainer può già fare via RLS. Mantenere il controllo
  "il destinatario è un member" (lato client + un `check` o trigger, per non fidarsi).
- [x] **4.6 — Report presenze.** Risolto con l'aggregato PostgREST `bookings(count)` invece di una vista: una riga per corso in rete, nessuna migration in più. Sostituire [reports.js](../../../backend/src/routes/reports.js)
  con una **vista** `class_attendance` (o aggregazione client-side: l'admin vede già tutto
  via RLS). La vista è preferibile — `security_invoker = true` per rispettare la RLS.
> ⚠️ **Riordino (2026-07-27): il 4.7 va PER PRIMO.** Quasi tutte le viste chiamano
> `/api/members` o `/api/users`, che esistono solo per unire l'email da `auth.users`:
> finché l'email non è su `profiles`, nessuna di quelle viste può staccarsi dal backend.
>
> **Scelta di progetto per la testabilità:** il MCP Playwright non è utilizzabile in questo
> ambiente (cerca Chrome di sistema in `/opt/google/chrome/chrome`, assente), quindi non c'è
> collaudo a click. Per non ridursi a testare riscritture delle query, il livello dati sta in
> `frontend/src/lib/data/` e **non dipende da `runtime-config`** (che usa `import.meta.env`,
> solo Vite): il client arriva da un registro (`lib/data/client.js`, `setDataClient()`
> chiamata da `initSupabase()`) e gli import relativi hanno l'estensione esplicita. Così gli
> e2e usa-e-getta importano ed eseguono **il codice vero dell'app** da node.

- [x] **4.7 — Email in `profiles`, addio `listUsers`.** Migration
  `20260727130000_profiles_email.sql`: colonna + backfill + trigger di sincronia
  (`sync_profile_email` su `auth.users`, `handle_new_user` estesa) + `email` aggiunta al
  guard dei campi privilegiati + indice. Modulo `lib/data/profiles.js` con
  `getOwnProfile/updateOwnProfile/listMembers/listUsers/updateUserRole/updateUserName`.
  Verificato con `scripts/tmp-e2e-data-profiles.mjs`: **15/15**, compresa la sincronia
  dell'email dopo un cambio via Auth API. Applicata in locale; **da applicare al cloud**. `GET /api/users` e `/api/members`
  esistono quasi solo per arricchire con l'email da `auth.users` via
  `auth.admin.listUsers()`. Aggiungere `profiles.email`, popolarla nel trigger
  `handle_new_user`, backfill con una `update ... from auth.users`, e tenerla in sincrono
  con un trigger su `auth.users`. Le due rotte diventano letture RLS.
- [x] **4.8 — Edge Function `admin-users`** ✅ deployata; CORS e 401/403 verificati in produzione. (l'unico pezzo che richiede davvero
  `service_role`): cambio email da admin (`auth.admin.updateUserById` con
  `email_confirm: true`). Deno + `supabase-js`, secret `SUPABASE_SERVICE_ROLE_KEY` nei
  secret delle function, **mai** nel bundle. Verificare il ruolo del chiamante dentro la
  function (il JWT arriva in `Authorization`), non fidarsi del client.
- [x] **4.9 — Diagnostica.** [diagnostics.js](../../../backend/src/routes/diagnostics.js)
  e metà di [lib/diagnostics.js](../../../frontend/src/lib/diagnostics.js) esistono per
  scoprire lo skew backend/DB — un problema che **cessa di esistere**. Ridurre il badge a:
  ambiente, raggiungibilità Supabase, latenza, versione dell'app.
- [x] **4.10 — Cancellare**: `backend/` intero, `lib/api.js`, `VITE_API_BASE_URL` (e
  `_SIM`) da `runtime-config.js` e dagli `.env*` — resta solo la scelta Supabase
  cloud/locale, quindi `runtime-config.js` si semplifica.
- [x] **4.11 — CI**: `ci.yml` perde il "controllo sintassi backend"; il build frontend resta.

**Verifica finale di fase:** giro completo sul device fisico con i tre ruoli — login,
prenotazione (compreso corso pieno), creazione scheda da trainer, assegnazione template,
sessione di allenamento con prefill dei carichi, report admin, cambio email da admin,
reset password. Più il rilancio dell'e2e ostile della Fase 1.6.

---

## Fase 5 — Spegnimento dell'EC2

- [ ] **5.1 — Backup, prima di toccare l'istanza.** `pg_dump` del cloud + **prova di
  ripristino** su Supabase locale (`db:reset` e poi restore): un backup non verificato non
  è un backup. Archiviare fuori dall'EC2.
- [x] **5.2 — GitHub Action `db-backup.yml` schedulata** ✅ `pg_dump | gzip | gpg AES-256`, verifica decifrando, pipeline collaudata in locale. ⚠️ **La cifratura è obbligatoria perché il repo è PUBBLICO**: gli artifact sono scaricabili da chiunque, e il job si rifiuta di partire senza `BACKUP_PASSPHRASE`. (il piano free Supabase **non ha
  backup automatici**): `pg_dump` verso la connection string del **Session pooler** (IPv4 —
  l'host diretto è solo IPv6), artifact con retention, o upload su R2/S3. Secret
  `SUPABASE_DB_URL`. Lanciarla a mano una volta per verificarla.
- [ ] **5.3 — Verificare che nulla punti più all'EC2:** `grep -rn "sslip\|DEPLOY_HOST"`,
  e che l'app iOS in produzione non chiami più `/api/*`.
- [ ] **5.4 — Terminare l'istanza e RILASCIARE l'Elastic IP.** ⚠️ Un Elastic IP non
  associato **si paga** (~3,6 $/mese): terminare la macchina senza rilasciare l'IP lascia
  addebiti. Controllare anche volumi EBS orfani e snapshot.
- [x] **5.5 — Cancellati** `deploy/`, `terraform/` e `.github/workflows/deploy.yml`; rimuovere i secret
  `DEPLOY_*` da GitHub.
- [ ] **5.6 — Riscrivere `DEPLOY.md` e `HANDOVER.md`** sulla nuova topologia; aggiornare
  `CLAUDE.md` (sezione Architettura: sparisce il livello backend, la regola "letture RLS
  dal client / scritture al backend" diventa "tutto dal client, `service_role` solo in
  Edge Function"). Chiudere l'AWS account se non serve ad altro.

**Verifica:** costo AWS del mese successivo = 0. L'app funziona con EC2 terminato.

---

## Fase 6 — Prima di aprire al mondo (quando decidi)

Hai ragione sul fatto che **non servono modifiche strutturali**: la topologia regge. Ma ci
sono tre cose che non sono strutturali e sono comunque obbligatorie.

- [ ] **6.1 — Supabase Pro ($25/mese).** Non per i PDF né per il dominio: perché il free
  tier **non fa backup automatici** e **mette in pausa il progetto dopo una settimana di
  inattività**. Con clienti veri e dati veri è il minimo. In regalo arrivano le **image
  transformations** (altrimenti solo Pro) e il Custom Domain diventa un +$10 invece di +$35.
- [ ] **6.2 — Cancellazione account in-app.** L'App Store la **richiede** per ogni app che
  permette di creare un account (linea guida 5.1.1(v)): serve una Edge Function con
  `auth.admin.deleteUser` + pulizia dei dati collegati. Senza, la review rifiuta.
- [ ] **6.3 — Pagine pubbliche su pallade.it**: privacy policy (URL obbligatorio in App
  Store Connect) e termini. Vanno su Pages — altro motivo per cui l'hosting statico serve
  anche se il web è "solo per te".
- [ ] **6.4 — HealthKit**: verificare che le usage description in `Info.plist` siano
  esplicite; è una delle cause di rifiuto più comuni.
- [ ] **6.5 — Difese**: rate limit di Auth rivisti, Cloudflare Turnstile sulla
  registrazione se compare spam, `429` gestiti nel client.
- [ ] **6.6 — Solo se aggiungi login Google/Apple:** lì il dominio di callback compare
  nella schermata di consenso → allora il Custom Domain add-on ha senso.

---

## Costi

| Voce | Oggi | Dopo |
|---|---|---|
| EC2 t4g.micro + Elastic IP | ~10-12 €/mese | 0 |
| Cloudflare Pages | — | 0 (free) |
| Supabase | 0 (free) | 0 (free) → $25 alla Fase 6 |
| Resend | 0 (free tier) | 0 |
| Dominio pallade.it | ~10-15 €/anno | uguale |

Limiti utili da tenere a mente: Cloudflare Workers free = **10 ms di CPU** per invocazione
(irrilevante qui: nessuna function su Pages); Supabase Edge Functions = **2 s di CPU**,
256 MB, 150 s di wall clock → è **lì** che va l'eventuale calcolo pesante futuro (PDF con
`pdf-lib`, immagini via WASM), non su Cloudflare free.

---

## Rischi e ordine di sicurezza

1. **Fase 1 prima della Fase 4**, senza scorciatoie: la Fase 4 rende la RLS l'unica difesa.
2. **Migration in cloud prima del codice.** Al contrario, il dato "non si salva" senza che
   nessuno segnali un errore.
3. **Bundle id nella Fase 3**, prima di qualsiasi pubblicazione.
4. **Elastic IP rilasciato**, non solo istanza terminata.
5. La Fase 4 va fatta a gruppi, con l'app ricostruita e provata sul device a ogni gruppo:
   un errore di policy si manifesta come "dashboard vuota", non come errore in console.
6. Se in qualsiasi momento serve l'EC2 spento in fretta, la Strada B della Fase 0 è il
   ponte: sposta il Fastify su un PaaS free e prosegui con calma.
