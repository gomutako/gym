# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Web app mobile-first per la gestione di una palestra. `frontend/` (Vue 3, unico workspace npm), `supabase/` (migrations + Edge Function). Tre ruoli: **admin**, **trainer**, **member**.

> **Architettura senza backend applicativo.** Il client parla direttamente con Supabase
> (PostgREST + Auth + Storage) usando la `anon` key; le regole vivono nel database (RLS +
> trigger). C'era un backend Fastify su EC2: è stato smantellato nella migrazione del
> 2026-07-27 verso Cloudflare Pages + Supabase — vedi
> `docs/superpowers/plans/2026-07-27-migrazione-cloudflare-supabase.md`.

> Per rimettere in piedi l'ambiente su una macchina nuova (cosa non è nel repo, segreti, stato produzione, casi di emergenza) vedi **`HANDOVER.md`**. Per il deploy: **`DEPLOY.md`**.

## Comandi

```bash
npm install            # installa root + workspace frontend

# Database locale (richiede Docker attivo)
npm run db:start       # supabase start — applica le migration
npm run db:status      # URL + chiavi locali
npm run db:reset       # ricrea il DB da zero riapplicando le migration
npm run db:stop
npm run seed           # dati demo (admin/trainer/member@gym.local, pwd password123)

npm run dev:fe         # Vite su :5173  (unico processo applicativo)

npm run build          # build di produzione del frontend
npm run db:push:dry    # anteprima delle migration da applicare al CLOUD
npm run db:push        # le applica (serve SUPABASE_DB_URL, vedi sotto)

# Edge Function (l'unico codice con la service_role key)
npx supabase functions serve --no-verify-jwt   # runtime locale
npx supabase functions deploy admin-users      # deploy in cloud
```

**Due ambienti Supabase**: in locale gira l'istanza CLI/Docker; in **produzione** si usa
**Supabase Cloud** (free tier, ref `nayiujdfvevccoluqwic`, region `eu-west-1`). Cambiano solo
le variabili (`frontend/.env` vs `frontend/.env.production`), il codice è identico. Le
migration locali si applicano con `db:reset`, quelle remote con `db:push` o col workflow
GitHub **DB migrate** (la CLI traccia da sé cosa è già applicato).

⚠️ **Da WSL `db push` verso l'host diretto non funziona** (`db.<ref>.supabase.co` ha solo
record AAAA/IPv6): serve la connection string del **Session pooler** in `SUPABASE_DB_URL`,
oppure il workflow GitHub. Le credenziali di servizio stanno in `.env.production` alla root
(gitignorato), non più sotto `backend/`.

Non esistono test unitari configurati: la verifica si fa con **script e2e usa-e-getta**
(`scripts/tmp-*.mjs`, gitignorati) che importano i **moduli veri** di `frontend/src/lib/data/`
e girano contro Supabase locale. È il motivo per cui quei moduli non dipendono da
`runtime-config` (che usa `import.meta.env`, solo Vite) e usano import con estensione
esplicita: senza, da node non si caricherebbero e si finirebbe a testare una riscrittura
delle query invece del codice dell'app. Pattern: creare il `.mjs`, eseguirlo, rimuoverlo.

### Ambiente / gotcha
- 🚨 **Il progetto NON deve stare in una cartella sincronizzata con iCloud** (`~/Desktop`
  e `~/Documenti` lo sono se è attivo "Cartelle Desktop e Documenti"). Tenerlo lì corrompe
  `node_modules` e `.git`: iCloud prova a sincronizzare decine di migliaia di file, ne
  riscrive i permessi a `600`, ritarda la materializzazione e lascia file *dataless*.
  I sintomi sono vari e fuorvianti — `vite build` appeso **a 0% di CPU** (attesa di I/O,
  non deadlock), `ERR_INVALID_PACKAGE_CONFIG` su `package.json` validi, `ENOENT` su file
  esistenti, moduli che non esportano ciò che dovrebbero, `cp` che fallisce con
  `Operation timed out` producendo file da 0 byte, e `git push` rifiutato con
  `index-pack failed` / `early EOF` perché gli oggetti non si leggono per intero.
  Diagnosi: `brctl status` (cerca `Needs Apply Changes` sul path del progetto) e
  `find . -type f -perm 600 -not -path "*/node_modules/*"`. Cura: spostare il progetto
  fuori (es. `~/Developer`); `brctl download <path>` materializza un file bloccato.
- **Docker** serve solo per Supabase; il codice si scrive/builda senza. La CLI Supabase (`supabase`) è una devDependency della root → invocarla con `npx supabase` o via script `db:*`.
- Su **Linux** la shell dell'agente può non essere nel gruppo `docker`: lì i comandi Supabase vanno prefissati con `sg docker -c "..."`. **Su macOS no**: `sg` non esiste (`command not found`) e i comandi si lanciano diretti.
- Il **link della CLI al progetto cloud sta in `supabase/.temp/`, che è gitignorato**: dopo un clone o uno spostamento del progetto `db:push` fallisce con `Cannot find project ref`. Si rimedia con `npx supabase link --project-ref <ref>` (il ref è il sottodominio dell'URL Supabase). Prima di applicare, `npx supabase migration list --linked` mostra cosa manca sul cloud e `db push --dry-run` cosa verrebbe applicato.
- ⚠️ **Il deploy NON applica le migration**: vanno applicate **prima** di rilasciare il codice che le usa. Il workflow **DB migrate** è manuale di proposito, perché Cloudflare Pages builda in automatico sul push e le due cose andrebbero in corsa. Nell'ordine sbagliato il sintomo è **silenzioso**: un client vecchio non conosce la colonna nuova e il dato non si salva senza che nessuno segnali un errore.
- ⚠️ **`ps | grep | kill` si auto-matcha**: se la shell sta eseguendo il comando che cerchi (es. `cap sync ios`), il grep trova se stessa e si uccide (exit 144, nessun output). Filtrare con `awk '/pattern/ && !/zsh/ && !/awk/ {print $1}'`, o avviare in background salvando il PID.
- **Node ≥ 22 obbligatorio**: Vite 8 richiede `@vitejs/plugin-vue` v6+; gli script e2e usano `structuredClone` e `await` a livello di modulo.
- ⚠️ **`[analytics] enabled` in `supabase/config.toml` deve restare `false`**: su WSL2 i container Logflare/Vector non superano l'healthcheck e bloccano `supabase start`. Un aggiornamento della CLI può riscriverlo a `true`: se `db:start` inizia a fallire con `container is not ready: unhealthy`, controllare lì per primo.
- ⚠️ **`npm install <pacchetto>` pota il binario nativo di Rolldown.** Vite 8 usa Rolldown, il cui binding per la piattaforma (`@rolldown/binding-darwin-arm64`) è una `optionalDependency`: installando un singolo pacchetto npm la rimuove da `node_modules` pur lasciandola nel `package-lock.json` (bug npm noto). Sintomo: `vite build` **resta appeso per sempre senza stampare nulla** — non dà errore, e tutti i thread sono in `uv_cond_wait`. Cura: `npm install` (senza argomenti) dalla root. Verifica: `ls node_modules/@rolldown/binding-darwin-arm64`.
- **`vite build` e `npx cap sync ios` non terminano** dopo aver completato il lavoro: producono l'output corretto e poi restano vivi. Non aspettarli — verificare l'artefatto (`frontend/dist/index.html`, `frontend/ios/App/App/public/index.html`) e chiudere per PID. Corollario: **non usare `| tail`** su questi comandi, perché la pipe bufferizza e non si vede alcun avanzamento; redirigere su un file di log e leggerlo.

### App iOS (Capacitor)

Il progetto Xcode sta in `frontend/ios/App` (workspace `App.xcworkspace`, schema `App`,
bundle id **`it.pallade.app`**, Team ID `7M9683Z95M`). L'app **incorpora** la SPA: ogni
modifica al frontend richiede di ricostruire il bundle e risincronizzarlo.

⚠️ Il bundle id è cambiato da `local.gym.app` il 2026-07-27, **prima** di qualsiasi
pubblicazione: dopo il primo rilascio su App Store non è più modificabile (sarebbe un'altra
app, con scheda e utenti da rifare). Conseguenza pratica: le installazioni fatte col vecchio
id **non ricevono aggiornamenti**, vanno disinstallate e reinstallate.

```bash
npm run build                     # dalla root: produce frontend/dist (usa .env.production)
cd frontend && npx cap sync ios   # DALLA CARTELLA frontend: copia dist in ios/App/App/public + pod
xcrun devicectl list devices      # UDID dei device collegati

# Device fisico
xcodebuild -workspace frontend/ios/App/App.xcworkspace -scheme App \
  -configuration Debug -destination 'id=<UDID>' -allowProvisioningUpdates build
xcrun devicectl device install app --device <UDID> <path>/Debug-iphoneos/App.app
xcrun devicectl device process launch --device <UDID> --console it.pallade.app
```

- **`--console` è l'unico modo per leggere i `console.log` JS dal device**: appaiono come
  `⚡️ [info] - …`. `log stream --device-name` **non esiste più** nelle versioni recenti di
  macOS, e in zsh `log` è un builtin che maschera `/usr/bin/log`.
- **Se l'iPhone è bloccato il lancio viene rifiutato** (`FBSOpenApplicationErrorDomain
  error 7`, "device was not, or could not be, unlocked"): l'installazione riesce comunque,
  serve solo sbloccarlo e rilanciare.
- ⚠️ **`cap sync` va lanciato da `frontend/`**, dove sta `capacitor.config.ts`. Dalla root
  fallisce con un messaggio fuorviante — *"ios platform has not been added yet"* — che fa
  pensare a un progetto Xcode mancante mentre è solo la cwd sbagliata.
- ⚠️ **Il provisioning free non firma l'entitlement Associated Domains.** Con il team
  personale gratuito `xcodebuild` si ferma **prima di compilare**: *"Personal development
  teams … do not support the Associated Domains capability"* seguito da *"No profiles for
  'it.pallade.app' were found"*. Per installare su device senza l'Apple Developer Program
  bisogna togliere `com.apple.developer.associated-domains` da `App.entitlements`,
  compilare, e ripristinare il file con `git checkout`. L'app così installata **non apre
  gli universal link**: il link di reset password finisce in Safari invece che nell'app —
  tutto il resto (login, dati, HealthKit) funziona.
- **Provisioning free (7 giorni).** Il profilo è `iOS Team Provisioning Profile` generato
  da Xcode; scaduto quello l'app va reinstallata. Gli entitlements HealthKit
  (`healthkit`, `healthkit.access: health-records`, `background-delivery`) sono invece
  supportati dal team personale e non richiedono niente di manuale.
- Per il simulatore vale lo stesso ciclo con
  `-destination 'platform=iOS Simulator,name=iPhone 16 Pro'` e `xcrun simctl`. Ricordare
  che nel simulatore l'app punta al **Supabase locale**: serve `npm run db:start` attivo,
  altrimenti login e dati falliscono per rete.
- L'app sul device chiama Supabase dall'origine `capacitor://localhost`. **PostgREST e Auth
  non filtrano per origine**, quindi la vecchia classe di guasti "login ok ma dashboard
  vuote per CORS" è sparita con il backend. Resta un solo punto in cui l'origine conta: la
  **Edge Function** `admin-users`, che ha una whitelist. Verificabile senza toccare il telefono:
  `curl -sD - -o /dev/null -X OPTIONS https://<ref>.supabase.co/functions/v1/admin-users -H 'Origin: capacitor://localhost' | grep -i access-control-allow-origin`
- **Universal link** (`applinks:pallade.it` in `App.entitlements`): fanno aprire ALL'APP i
  link `https://pallade.it/…` invece di Safari. Servono al reset password, il cui link
  arriva per email. Il file di associazione è versionato in
  `frontend/public/.well-known/apple-app-site-association` (Team ID + bundle id) e
  `frontend/public/_headers` gli impone `application/json` — senza quel content-type iOS lo
  ignora in silenzio. Verifica lato server:
  `curl -sI https://pallade.it/.well-known/apple-app-site-association | grep -i content-type`
  Lato device si prova solo installando l'app: iOS scarica il file alla prima installazione.

#### Pubblicazione su App Store (non ancora fatta)

Prerequisiti che **bloccano la review** se mancanti, dettagliati nella Fase 6 di
`docs/superpowers/plans/2026-07-27-migrazione-cloudflare-supabase.md`:

- **Cancellazione account in-app** — obbligatoria per ogni app che permette di registrarsi
  (linea guida 5.1.1(v)). Richiede una Edge Function con `auth.admin.deleteUser` più la
  pulizia dei dati collegati: non basta un modulo di richiesta.
- ✅ **Privacy policy e termini** — `frontend/public/{privacy,termini}.html` + `legal.css`,
  pubblicati a `https://pallade.it/privacy.html` e `/termini.html` (il primo è il campo
  obbligatorio in App Store Connect). Sono file statici, non rotte della SPA: restano
  leggibili anche se l'app non si carica. Quando arriverà la cancellazione account in-app
  va aggiornato il §7 della privacy, che oggi indirizza alla richiesta via email.
- **HealthKit**: usage description esplicite in `Info.plist` — è una delle cause di rifiuto
  più comuni, e l'app chiede frequenza cardiaca e calorie.
- **Apple Developer Program** ($99/anno): il provisioning free dura 7 giorni e non permette
  né TestFlight né la pubblicazione.
- **Supabase Pro** consigliato prima di avere utenti veri: il piano free non fa backup
  automatici e mette in pausa il progetto dopo una settimana di inattività.

#### Build di release e upload su App Store Connect

⚠️ **Questo flusso non è mai stato eseguito**: senza Apple Developer Program a pagamento
l'`archive` firma ma l'export in `app-store-connect` fallisce (il provisioning free non
produce certificati di distribuzione). I comandi sono verificati contro `xcodebuild -help`
di Xcode 26.6, non contro un rilascio vero — al primo tentativo aspettarsi aggiustamenti,
e aggiornare questa sezione con quello che si scopre.

**1. Allineare la versione.** `npm version` tocca i `package.json`, **non** il progetto
Xcode: `MARKETING_VERSION` e `CURRENT_PROJECT_VERSION` vivono in `project.pbxproj` e vanno
alzati a mano (Xcode → target App → General, oppure `sed`). `CFBundleVersion`
(= `CURRENT_PROJECT_VERSION`) deve **crescere a ogni upload**, anche a parità di versione
marketing: App Store Connect rifiuta un build number già visto. `agvtool` qui non serve —
il progetto non usa `VERSIONING_SYSTEM = apple-generic` e i suoi comandi non trovano nulla
da aggiornare.

```bash
# <ver> = la versione del CHANGELOG, <n> = build number precedente + 1
sed -i '' "s/MARKETING_VERSION = .*/MARKETING_VERSION = <ver>;/; \
          s/CURRENT_PROJECT_VERSION = .*/CURRENT_PROJECT_VERSION = <n>;/" \
  frontend/ios/App/App.xcodeproj/project.pbxproj
grep -n "MARKETING_VERSION\|CURRENT_PROJECT_VERSION" frontend/ios/App/App.xcodeproj/project.pbxproj
```

**2. Ricostruire il bundle prima dell'archive.** Saltare questo passo non dà errore:
si archivia la SPA vecchia già presente in `ios/App/App/public` e l'app pubblicata resta
indietro di una versione senza che nulla lo segnali.

```bash
npm run build && npx cap sync ios     # ricorda: non terminano, verifica l'artefatto e chiudi per PID

xcodebuild -workspace frontend/ios/App/App.xcworkspace -scheme App \
  -configuration Release -destination 'generic/platform=iOS' \
  -archivePath build/App.xcarchive -allowProvisioningUpdates archive

xcodebuild -exportArchive -archivePath build/App.xcarchive \
  -exportOptionsPlist frontend/ios/App/ExportOptions.plist \
  -exportPath build/export -allowProvisioningUpdates \
  -authenticationKeyPath ~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8 \
  -authenticationKeyID <KEYID> -authenticationKeyIssuerID <ISSUER-UUID>
```

`ExportOptions.plist` (da creare; contiene solo il Team ID, non è un segreto):

```xml
<key>method</key>        <string>app-store-connect</string>
<key>teamID</key>        <string>7M9683Z95M</string>
<key>destination</key>   <string>upload</string>
<key>signingStyle</key>  <string>automatic</string>
```

- `destination: upload` carica direttamente su App Store Connect; con `export` (default)
  si ottiene solo l'`.ipa` in `build/export`, da caricare poi con Transporter.
- `method: app-store-connect` è il nome attuale — `app-store` funziona ancora ma è
  deprecato. Per una build di test interna il valore è `release-testing`.
- La chiave `.p8` si genera in App Store Connect → Users and Access → Integrations, si
  scarica **una volta sola** e va tenuta fuori dal repo. In alternativa a
  `-authenticationKey*` basta l'account Apple aggiunto in Xcode → Settings → Accounts, ma
  con la chiave il comando funziona anche in CI.
- `-allowProvisioningUpdates` serve anche in export: è lì che viene creato il profilo di
  distribuzione, entitlement HealthKit compresi.

**3. Dopo l'upload**: la build resta in *Processing* qualche minuto, poi va compilata la
export compliance (nessuna crittografia oltre HTTPS → esente) prima che TestFlight la renda
installabile.

## Architettura

### Sicurezza: la RLS è l'UNICA difesa (chiave del progetto)
Il client usa la `anon` key, che è **pubblica per costruzione** (sta nel bundle). Non esiste
più un backend che filtri le richieste: chiunque abbia un account può chiamare PostgREST
direttamente. Quindi ogni regola deve stare nel database, e una policy scritta con
distrazione **è** una vulnerabilità, non un buco coperto da un secondo livello.

- **Policy RLS** su tutte le tabelle. Usano `public.current_user_role()` (`SECURITY DEFINER`)
  per leggere il ruolo senza ricorsione.
- **Guard trigger** per ciò che le policy non sanno esprimere, cioè i limiti *per colonna*:
  `profiles_guard_privileged_fields` (solo l'admin cambia `role`/`subscription_end_date`;
  l'`email` si cambia solo da Auth) e `workouts_guard_member_fields` (il member tocca solo
  `is_active`/`archived`). Sono `SECURITY INVOKER` di proposito: solo così `current_user`
  riflette il chiamante. Lasciano passare `service_role`, `postgres`, `supabase_admin`.
- **Trigger di invariante** per la logica che il client non deve poter aggirare:
  `bookings_enforce_capacity` (conta con `for update`, quindi senza race),
  `workouts_enforce_single_active`, `sync_subscription_end`, `sync_profile_email`,
  e i validatori di forma di `days_json`/`exercises_log`.
- **Edge Function `admin-users`** — l'unico codice con la `service_role` key, per il cambio
  email (che vive in `auth.users`). Rilegge il ruolo dal DB, non dal JWT.

Regola pratica: **tutto dal client** via `frontend/src/lib/data/`; la `service_role` key solo
in una Edge Function, mai nel bundle. Aggiungendo una tabella o una colonna, la domanda da
farsi è "quale policy e quale trigger la proteggono?", non "quale rotta la valida".

### Autenticazione
Supabase Auth. Un trigger DB (`handle_new_user`) crea automaticamente una riga `profiles` a ogni signup, con ruolo dai metadati (`raw_user_meta_data.role`, default `member`). Il ruolo dell'utente sta in `profiles.role`, non nel JWT.

### Livello dati (`frontend/src/lib/data/`)
Un modulo per risorsa, che ha preso il posto delle rotte del backend. Le viste non compongono
query: chiamano queste funzioni.
- `client.js` — registro del client (`setDataClient()`, chiamata da `initSupabase()`),
  `unwrap()` che traduce gli errori PostgREST in messaggi italiani, e la mappa `PG` dei codici.
  ⚠️ `unwrap` **non** sovrascrive i messaggi dei guard trigger: `42501` arriva sia dalla RLS
  su un INSERT (testo inglese, da tradurre) sia dai trigger (già in italiano, da preservare),
  e i due casi si distinguono dal testo.
- `profiles.js` · `classes.js` · `exercises.js` · `subscriptions.js` · `templates.js` ·
  `bookings.js` · `workouts.js` · `sessions.js` · `reports.js` · `admin.js`.
- Logica che era nel backend e ora vive qui: la precompilazione dei carichi
  (`sessions.startSession`, legge solo dati del member stesso) e la clonazione di un modello
  (`workouts.assignTemplate`). Il resto è passato al database.
- ⚠️ Creando una scheda va passato `trainer_id`: prima lo impostava il backend dal JWT, ora
  `workouts_write` **pretende** `trainer_id = auth.uid()` per i trainer.
- `reports.js` usa il conteggio aggregato di PostgREST (`bookings(count)`): una riga per corso
  invece di una per prenotazione, che con l'egress del piano free è la differenza tra un
  report che cresce col tempo e uno che resta costante.

### Frontend (`frontend/src/`)
- Vue 3 `<script setup>`, Pinia, Vue Router, TailwindCSS mobile-first. Alias `@` → `src`.
- `main.js` risolve la config d'ambiente (`initRuntimeConfig()`), crea il client Supabase (`initSupabase()`) e ripristina la sessione (`authStore.init()`) **prima** di montare, così le guardie del router conoscono lo stato di login.
- `lib/runtime-config.js` — **la config è risolta a runtime, non a build-time**: l'app iOS è un bundle statico, quindi contiene due coppie di variabili e all'avvio sceglie in base a `@capacitor/device` → `isVirtual`. Simulatore iOS → `VITE_*_SIM` (Supabase locale); device e web → `VITE_*` (cloud). Conseguenza: `supabase` in `lib/supabase.js` è un `let` assegnato da `initSupabase()`, quindi **non usarlo a livello di modulo** — solo dentro funzioni (i live binding ES fanno il resto).
- `stores/auth.js` — sessione, `role`, `isSubscriptionActive`, login/register/logout.
- `router/index.js` — area protetta sotto `layouts/AppLayout.vue` (header + `components/BottomNav.vue`); guardie su `meta.requiresAuth` e `meta.roles`.
- **Navigazione role-aware**: `views/HomeDispatcher.vue` sceglie la dashboard (member/trainer/admin) e `BottomNav` cambia le tab in base al ruolo. L'admin oggi non ha una dashboard member: le viste sono divise in `views/{member,trainer,admin}/`.
- `lib/diagnostics.js` + `components/ServiceStatusBadge.vue` — badge admin con ambiente, raggiungibilità di Supabase e sessione. Sondava anche il backend per scoprire lo skew di versione: quella classe di guasti non esiste più.
- `lib/storage.js` — upload immagini esercizi e URL pubblici dal bucket Storage.

### Modello dati (`supabase/migrations/`)
Le migration sono append-only ma in dev locale si riapplicano con `db:reset`. Tabelle: `profiles`, `classes`, `bookings`, `workouts`, `workout_templates`, `exercises`, `workout_sessions`.
- **Esercizi** (`exercises`): catalogo di *tipi* di esercizio con immagini e descrizione **condivise per tipo** (single source of truth). Il seed **importa l'intero free-exercise-db (~873 voci)**: nomi in **inglese** (fonte), metadati **tradotti in italiano**. Immagini nel bucket Storage pubblico `exercise-images` (upload solo trainer/admin): `image_path` = copertina, `image_paths` (`text[]`) = tutte (carousel). `load_type` (`weight`|`level`) decide se si registra peso in kg o livello. Campi: `muscle_group` (muscolo primario), `video_url` (YouTube, diretto se curato altrimenti ricerca), `instructions` (`text[]`, passi di esecuzione), `equipment`/`category` (testo), `force` (`spinta`|`trazione`|`statico`), `level` (`principiante`|`intermedio`|`avanzato`), `mechanic` (`composto`|`isolamento`), `secondary_muscles` (`text[]`). Gli enum sono in italiano; il seed traduce i valori inglesi della fonte (tabelle `*_IT` in `scripts/seed.mjs`).
- **Schede** (`workouts`): entità con `title` e `days_json` = giornate, ognuna con esercizi che referenziano il catalogo: `[{ name, exercises: [{ exercise_id, sets, reps, rest_seconds }] }]`. Un member può avere più schede.
- **Schede preconfezionate** (`workout_templates`): libreria di programmi pronti (stessa forma `days_json` delle schede) NON legati a un member. Trainer/admin le gestiscono e le **assegnano** a un cliente con `data/workouts.js → assignTemplate()`, che ne fa una **copia** indipendente in `workouts` (modificare il modello dopo non tocca le schede già assegnate). Vista `views/trainer/TemplatesView.vue`, seed di ~8 programmi noti (PPL, Full Body, 5x5, Arnold split…).
- **Sessioni** (`workout_sessions`): il member "inizia un allenamento" scegliendo scheda + giornata; la sessione fa uno **snapshot** della giornata così storico e calendario restano corretti anche se la scheda cambia. `exercises_log` = `[{ exercise_id, target_reps, rest_seconds, load_type, sets_log: [{ reps, load, done, done_at }] }]`: una riga per serie con reps effettuate e carico (kg o livello). All'avvio (`data/sessions.js → startSession()`) il client **precompila i carichi** dall'ultima sessione completata che conteneva lo stesso esercizio (guarda le 30 più recenti). `completed_at` null = in corso. Il timer di recupero per serie è solo lato client (SessionView).

Modificando lo schema: creare una nuova migration, aggiornare il modulo di `frontend/src/lib/data/` corrispondente (compresi i campi scrivibili, che sostituiscono `additionalProperties: false` degli schemi Fastify), `scripts/seed.mjs`, e le viste che leggono quei campi. Poi applicarla al cloud **prima** di rilasciare il codice.
