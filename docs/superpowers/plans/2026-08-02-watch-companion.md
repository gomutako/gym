# App companion Apple Watch — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una app watchOS che possiede la sessione di allenamento HealthKit — frequenza cardiaca in tempo reale, esecuzione in background, recupero con avviso al polso — e resta interamente opzionale rispetto all'app iPhone.

**Architecture:** Un target watchOS SwiftUI dentro il progetto Xcode esistente, che parla con l'app iPhone via WatchConnectivity. Sull'iPhone un plugin Capacitor (`WatchLink`) fa da unico punto di contatto e **bufferizza** su disco ciò che arriva mentre la WebView è sospesa. Il livello web consuma il buffer e scrive su Supabase: nessuna credenziale vive al polso. Lo stato condiviso è un insieme accrescitivo di serie completate identificate da `uid` stabili, fuso con regole deterministiche replicate in JS e Swift.

**Tech Stack:** SwiftUI + HealthKit + WatchConnectivity (watchOS 10+), Capacitor 6 plugin Swift (iOS), Vue 3 `<script setup>`, Supabase/PostgREST.

**Spec di riferimento:** [`docs/superpowers/specs/2026-08-02-watch-companion-design.md`](../specs/2026-08-02-watch-companion-design.md)

## Global Constraints

- **Node ≥ 22** obbligatorio (Vite 8 / Rolldown; gli script e2e usano `await` a livello di modulo).
- **Nessun test runner configurato.** La verifica si fa con script e2e usa-e-getta `scripts/tmp-*.mjs` (gitignorati) che importano i **moduli veri** di `frontend/src/lib/`, con **import con estensione esplicita**, girando contro Supabase locale (`npm run db:start`). Pattern: creare il `.mjs`, eseguirlo, rimuoverlo. I moduli sotto `lib/data/` **non devono dipendere da `runtime-config`** (usa `import.meta.env`, solo Vite).
- **Bundle id:** iPhone `it.pallade.app`, Watch `it.pallade.app.watchkitapp` (il prefisso è imposto da watchOS). **Team ID:** `7M9683Z95M`.
- **Deployment target watchOS: 10.0.** iOS resta 13.0.
- **`npx cap sync ios` va lanciato da `frontend/`**, mai dalla root. `npm run build` e `cap sync` **non terminano**: verificare l'artefatto (`frontend/dist/index.html`, `frontend/ios/App/App/public/index.html`) e chiudere per PID. Non usare `| tail` — redirigere su file di log.
- **I plugin Capacitor scritti a mano non vengono scoperti automaticamente**: vanno registrati in `frontend/ios/App/App/ViewController.swift` dentro `capacitorDidLoad()` con `registerPluginInstance(_:)`, e dichiarati in un file `.m` con la macro `CAP_PLUGIN`.
- **Ogni messaggio utente è in italiano.** Gli errori dei guard trigger sono già in italiano e `unwrap()` non li sovrascrive.
- **Le migration vanno applicate al cloud PRIMA di rilasciare il codice che le usa** (`npm run db:push` o workflow GitHub *DB migrate*). Nell'ordine sbagliato il sintomo è silenzioso.
- **La regola di design:** nessuna funzionalità applicativa esiste solo al polso. Ogni task deve lasciare l'app iPhone pienamente funzionante senza Watch, e il web (browser/PWA) identico a oggi.

---

### Task 1: Spike di provisioning — il target watchOS si installa sul polso

Questo task esiste per far fallire il progetto **subito** se deve fallire. Non è verificato che il provisioning gratuito regga un secondo App ID con entitlement HealthKit: se non passa, servirà l'Apple Developer Program a pagamento e va saputo prima di scrivere UI.

**Files:**
- Create: `frontend/ios/App/PalladeWatch Watch App/PalladeWatchApp.swift`
- Create: `frontend/ios/App/PalladeWatch Watch App/ContentView.swift`
- Create: `frontend/ios/App/PalladeWatch Watch App/Info.plist`
- Create: `frontend/ios/App/PalladeWatch Watch App/PalladeWatch.entitlements`
- Modify: `frontend/ios/App/App.xcodeproj/project.pbxproj` (via Xcode, non a mano)

**Interfaces:**
- Consumes: niente.
- Produces: un target Xcode chiamato `PalladeWatch Watch App` con schema omonimo, installabile su un Apple Watch accoppiato.

- [ ] **Step 1: Aggiungere il target in Xcode**

Aprire `frontend/ios/App/App.xcworkspace`.

⚠️ **Selezionare prima l'icona blu del progetto `App` nel Project Navigator.** Il workspace
contiene anche `Pods`, e il target finisce nel progetto selezionato: con `Pods` attivo la
tendina dei companion resta vuota (`None` è l'unica voce) e *Finish* non si abilita, senza
che nulla spieghi il perché.

Poi File → New → Target → watchOS → **App**. Impostare:

- Product Name: `PalladeWatch`
- Team: il team personale (`7M9683Z95M`)
- **Watch App for Existing iOS App** → nella tendina scegliere **`App`**
- Testing System: **XCTest for Unit and UI Tests** — crea il bundle di test che serve al
  Task 9. Scegliendo *Swift Testing* i test di quel task andrebbero riscritti con `@Test` e
  `#expect`, quindi non è intercambiabile.
- Alla domanda "Activate scheme?" rispondere Activate.

Nota: nelle versioni recenti di Xcode non esiste più la casella "Include Notification
Scene", e l'interfaccia è SwiftUI senza doverlo dichiarare.

Xcode crea la cartella `PalladeWatch Watch App/`. Poi verificare, sul nuovo target:

- **General → Identity → Bundle Identifier = `it.pallade.app.watchkitapp`.** L'anteprima nel
  dialogo di creazione mostra `com.yourcompany.PalladeWatch` e **non si aggiorna** quando si
  aggancia il companion: va controllato dopo. Se è rimasto sbagliato, correggerlo qui e nel
  target di test — dopo la pubblicazione non è più modificabile.
- **General → Minimum Deployments = watchOS 10.0**
- **Signing & Capabilities** → Team `7M9683Z95M`, *Automatically manage signing* attivo

- [ ] **Step 2: Dichiarare HealthKit e il background di allenamento**

Nel target `PalladeWatch Watch App` → Signing & Capabilities → **+ Capability** → **HealthKit**. Xcode crea `PalladeWatch.entitlements` con `com.apple.developer.healthkit`.

Poi aprire `PalladeWatch Watch App/Info.plist` come *Source Code* e aggiungere dentro il `<dict>` di primo livello:

```xml
<key>WKBackgroundModes</key>
<array>
    <string>workout-processing</string>
</array>
<key>NSHealthShareUsageDescription</key>
<string>Pallade legge la tua frequenza cardiaca e le calorie durante l'allenamento per mostrartele in tempo reale.</string>
<key>NSHealthUpdateUsageDescription</key>
<string>Pallade salva l'allenamento in Salute, così anelli e cronologia restano aggiornati.</string>
```

Le due usage description sono obbligatorie: senza, l'app **va in crash** alla prima chiamata HealthKit, e la loro assenza è una delle cause di rifiuto più comuni in review.

- [ ] **Step 3: Scrivere la app minima**

`frontend/ios/App/PalladeWatch Watch App/PalladeWatchApp.swift`:

```swift
import SwiftUI

@main
struct PalladeWatchApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
```

`frontend/ios/App/PalladeWatch Watch App/ContentView.swift`:

```swift
import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack(spacing: 8) {
            Text("Pallade")
                .font(.headline)
            Text("Spike di provisioning")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}
```

- [ ] **Step 4: Compilare e installare sul Watch fisico**

Il Watch va accoppiato all'iPhone collegato. Ricavare l'UDID:

```bash
xcrun devicectl list devices
```

Poi compilare per il target watchOS:

```bash
cd /Users/gomutako/Developer/gym && xcodebuild \
  -workspace frontend/ios/App/App.xcworkspace \
  -scheme 'PalladeWatch Watch App' \
  -configuration Debug \
  -destination 'id=<UDID-WATCH>' \
  -allowProvisioningUpdates build 2>&1 | tee /tmp/watch-build.log; \
  grep -E 'BUILD (SUCCEEDED|FAILED)|error:' /tmp/watch-build.log | head -20
```

Atteso: `BUILD SUCCEEDED`.

**Se fallisce con `No profiles for 'it.pallade.app.watchkitapp' were found` o un messaggio su *Personal development teams*: FERMARSI E RIFERIRE.** È l'esito che questo task esiste per scoprire; il progetto richiede allora l'Apple Developer Program e ogni task successivo è bloccato sul device (restano eseguibili in simulatore i Task 2, 3, 4).

- [ ] **Step 5: Verificare che l'app compaia sul polso**

Installare e lanciare:

```bash
xcrun devicectl device install app --device <UDID-WATCH> \
  ~/Library/Developer/Xcode/DerivedData/App-*/Build/Products/Debug-watchos/'PalladeWatch Watch App.app'
```

Atteso: sul quadrante compare l'icona Pallade e l'app mostra "Spike di provisioning". Se l'orologio è bloccato l'installazione riesce ma il lancio viene rifiutato: sbloccarlo e rilanciare.

- [ ] **Step 6: Verificare che `cap sync` non danneggi il target**

Il rischio è che la sincronizzazione Capacitor riscriva il progetto Xcode rimuovendo il target aggiunto a mano.

```bash
cd /Users/gomutako/Developer/gym/frontend && npx cap sync ios > /tmp/capsync.log 2>&1 &
sleep 60; kill %1 2>/dev/null
grep -c 'PalladeWatch' /Users/gomutako/Developer/gym/frontend/ios/App/App.xcodeproj/project.pbxproj
```

Atteso: un conteggio **maggiore di zero** (il target è ancora lì). Se è zero, riferire: servirà rigenerare il target dopo ogni `cap sync`, e va documentato in `CLAUDE.md`.

- [ ] **Step 7: Commit**

```bash
cd /Users/gomutako/Developer/gym
git add frontend/ios/App
git commit -m "feat(watch): target watchOS con HealthKit e background di allenamento

Spike di provisioning: verifica che il team personale regga un secondo
App ID con entitlement HealthKit prima di scrivere qualsiasi UI.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `uid` stabile sulle serie e colonna `client_session_id`

Le serie sono referenziate per posizione e sull'iPhone si possono aggiungere o togliere righe: un messaggio dal Watch che dice "fatta la serie 2" atterrerebbe sulla riga sbagliata. Ogni riga riceve un `uid`; il protocollo fra dispositivi non userà mai indici.

**Files:**
- Create: `supabase/migrations/20260802120000_watch_companion.sql`
- Modify: `frontend/src/lib/data/sessions.js` (funzione `startSession`, righe 98-135; `updateSession`, righe 142-161)
- Modify: `frontend/src/views/member/SessionView.vue` (funzione `addSet`, righe 281-291)

**Interfaces:**
- Consumes: niente.
- Produces:
  - Ogni riga di `sets_log` ha un campo `uid: string` (UUID v4).
  - `workout_sessions.client_session_id uuid | null`, unico per `(member_id, client_session_id)` quando non nullo.
  - `updateSession(id, { exercises_log, completed_at, biometrics_json, client_session_id })`.

- [ ] **Step 1: Scrivere la migration**

`supabase/migrations/20260802120000_watch_companion.sql`:

```sql
-- =====================================================
-- MIGRATION — Correlazione fra sessione nata sul Watch e riga Supabase.
--
-- Una sessione avviata al polso non ha ancora un id: chi la apre genera un
-- client_session_id che accompagna ogni messaggio. L'indice unico rende la
-- materializzazione IDEMPOTENTE — svuotare il buffer due volte (succede se
-- l'app iPhone viene uccisa a metà) non crea due sessioni gemelle.
--
-- Nessuna nuova policy: la RLS di workout_sessions protegge già la riga per
-- member_id, e questa colonna è un dato come gli altri. Il guard di forma di
-- exercises_log è volutamente largo e non va toccato: accetta già le righe
-- di sets_log con il nuovo campo `uid`.
-- =====================================================
alter table public.workout_sessions
  add column client_session_id uuid;

create unique index idx_sessions_client_session
  on public.workout_sessions (member_id, client_session_id)
  where client_session_id is not null;
```

- [ ] **Step 2: Applicare la migration in locale e verificare l'indice**

```bash
cd /Users/gomutako/Developer/gym && npm run db:reset
```

Atteso: nessun errore. Poi verificare che l'unicità morda davvero:

```bash
cd /Users/gomutako/Developer/gym && npm run seed
```

Atteso: il seed completa senza errori (le sessioni demo hanno `client_session_id` nullo e l'indice parziale non le tocca — se fallisse, l'indice non sarebbe parziale).

- [ ] **Step 3: Scrivere lo script e2e che fallisce**

Creare `scripts/tmp-uid.mjs`:

```js
import { createClient } from '@supabase/supabase-js';
import { setDataClient } from '../frontend/src/lib/data/client.js';
import { startSession } from '../frontend/src/lib/data/sessions.js';

const URL = process.env.SB_URL;
const KEY = process.env.SB_ANON;
const client = createClient(URL, KEY);
setDataClient(client);

const { data: auth, error } = await client.auth.signInWithPassword({
  email: 'member@gym.local', password: 'password123',
});
if (error) throw error;
const memberId = auth.user.id;

const { data: workouts } = await client
  .from('workouts').select('id').eq('member_id', memberId).limit(1);
const session = await startSession(workouts[0].id, 0, memberId);

const uids = session.exercises_log.flatMap((ex) => ex.sets_log.map((r) => r.uid));
console.log('serie:', uids.length, 'uid presenti:', uids.filter(Boolean).length);
console.log('uid unici:', new Set(uids).size);

if (uids.some((u) => !u)) throw new Error('FALLITO: qualche serie non ha uid');
if (new Set(uids).size !== uids.length) throw new Error('FALLITO: uid duplicati');
console.log('OK');

await client.from('workout_sessions').delete().eq('id', session.id);
```

- [ ] **Step 4: Eseguirlo e verificare che fallisca**

```bash
cd /Users/gomutako/Developer/gym && npm run db:status
```

Prendere `API URL` e `anon key`, poi:

```bash
cd /Users/gomutako/Developer/gym && SB_URL=<url> SB_ANON=<key> node scripts/tmp-uid.mjs
```

Atteso: `FALLITO: qualche serie non ha uid`.

- [ ] **Step 5: Generare gli `uid` in `startSession`**

In `frontend/src/lib/data/sessions.js`, dentro `startSession`, sostituire la costruzione di `sets_log` (righe 103-109) con:

```js
    const sets_log = Array.from({ length: nSets }, (_, i) => ({
      // Identità STABILE della serie. Il protocollo Watch↔iPhone referenzia
      // sempre uid e mai la posizione: addSet/removeSet sull'iPhone spostano
      // gli indici, e un "fatto" in volo atterrerebbe sulla riga sbagliata.
      uid: crypto.randomUUID(),
      reps: prev[i]?.reps ?? e.reps ?? null,
      load: prev[i]?.load ?? null,
      // la pendenza esiste solo per gli esercizi che la prevedono (es. tapis roulant)
      ...(hasIncline ? { incline: prev[i]?.incline ?? null } : {}),
      done: false,
    }));
```

- [ ] **Step 6: Eseguire di nuovo e verificare che passi**

```bash
cd /Users/gomutako/Developer/gym && SB_URL=<url> SB_ANON=<key> node scripts/tmp-uid.mjs
```

Atteso: `OK`, con `uid presenti` uguale a `serie` e `uid unici` uguale a `serie`.

- [ ] **Step 7: Dare un `uid` anche alle serie aggiunte a mano**

In `frontend/src/views/member/SessionView.vue`, in `addSet` (riga 284), aggiungere `uid` come primo campo del nuovo oggetto:

```js
  ex.sets_log.push({
    uid: crypto.randomUUID(),
    reps: last?.reps ?? ex.target_reps ?? null,
    load: last?.load ?? null,
    ...(hasIncline(ex) ? { incline: last?.incline ?? null } : {}),
    done: false,
  });
```

Senza questo, una serie aggiunta durante l'allenamento sarebbe invisibile al Watch.

- [ ] **Step 8: Accettare `client_session_id` in `updateSession`**

In `frontend/src/lib/data/sessions.js`, in `updateSession` (righe 142-147), aggiungere il campo scrivibile:

```js
export async function updateSession(id, { exercises_log, completed_at, biometrics_json, client_session_id }) {
  const patch = {};
  if (exercises_log !== undefined) patch.exercises_log = exercises_log;
  if (completed_at !== undefined) patch.completed_at = completed_at;
  if (biometrics_json !== undefined) patch.biometrics_json = biometrics_json;
  if (client_session_id !== undefined) patch.client_session_id = client_session_id;
  if (Object.keys(patch).length === 0) throw new Error('Nessun campo da aggiornare');
```

- [ ] **Step 9: Rimuovere lo script e committare**

```bash
cd /Users/gomutako/Developer/gym && rm scripts/tmp-uid.mjs
git add supabase/migrations/20260802120000_watch_companion.sql frontend/src/lib/data/sessions.js frontend/src/views/member/SessionView.vue
git commit -m "feat(sessions): uid stabile sulle serie e client_session_id

Il protocollo con il Watch non può usare indici posizionali: addSet e
removeSet li spostano e un \"fatto\" in volo atterrerebbe sulla riga
sbagliata. L'indice unico parziale rende idempotente la materializzazione
di una sessione nata al polso.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: La fusione come funzione pura

L'unica logica non banale del progetto. Vive isolata dalla vista perché va provata da node e replicata in Swift.

**Files:**
- Create: `frontend/src/lib/session-merge.js`

**Interfaces:**
- Consumes: le righe di `sets_log` con `uid` (Task 2).
- Produces: `mergeSetDone(exercisesLog, event) -> { log, changed }` dove `event` è `{ uid, reps, load, incline?, done_at }`.

- [ ] **Step 1: Scrivere lo script di test che fallisce**

Creare `scripts/tmp-merge.mjs`:

```js
import { mergeSetDone } from '../frontend/src/lib/session-merge.js';

const base = () => [{
  exercise_id: 'e1', rest_seconds: 90,
  sets_log: [
    { uid: 'a', reps: 10, load: 50, done: false },
    { uid: 'b', reps: 10, load: 50, done: false },
  ],
}];

let fails = 0;
const check = (name, cond) => {
  console.log((cond ? 'OK  ' : 'FAIL') + '  ' + name);
  if (!cond) fails++;
};

// 1. Una serie non ancora fatta viene marcata
let r = mergeSetDone(base(), { uid: 'a', reps: 12, load: 55, done_at: '2026-08-02T10:00:00.000Z' });
check('marca la serie', r.log[0].sets_log[0].done === true);
check('applica i valori', r.log[0].sets_log[0].reps === 12 && r.log[0].sets_log[0].load === 55);
check('segnala il cambiamento', r.changed === true);
check('non tocca le altre', r.log[0].sets_log[1].done === false);

// 2. Idempotenza: stesso evento due volte
let r2 = mergeSetDone(r.log, { uid: 'a', reps: 12, load: 55, done_at: '2026-08-02T10:00:00.000Z' });
check('idempotente', r2.changed === false);

// 3. done_at più vecchio vince
let r3 = mergeSetDone(r.log, { uid: 'a', reps: 8, load: 40, done_at: '2026-08-02T10:05:00.000Z' });
check('il piu recente non sovrascrive', r3.log[0].sets_log[0].reps === 12);
check('nessun cambiamento', r3.changed === false);

let r4 = mergeSetDone(r.log, { uid: 'a', reps: 8, load: 40, done_at: '2026-08-02T09:55:00.000Z' });
check('il piu vecchio vince', r4.log[0].sets_log[0].reps === 8);
check('cambiamento segnalato', r4.changed === true);

// 4. uid sconosciuto: nessun effetto, nessuna eccezione
let r5 = mergeSetDone(base(), { uid: 'zzz', reps: 1, load: 1, done_at: '2026-08-02T10:00:00.000Z' });
check('uid sconosciuto ignorato', r5.changed === false);

// 5. incline preservato solo se presente nell'evento
let r6 = mergeSetDone(base(), { uid: 'b', reps: 10, load: 5, incline: 3, done_at: '2026-08-02T10:00:00.000Z' });
check('incline applicato', r6.log[0].sets_log[1].incline === 3);
let r7 = mergeSetDone(base(), { uid: 'b', reps: 10, load: 5, done_at: '2026-08-02T10:00:00.000Z' });
check('incline assente non introdotto', !('incline' in r7.log[0].sets_log[1]));

// 6. immutabilità dell'ingresso
const original = base();
mergeSetDone(original, { uid: 'a', reps: 99, load: 99, done_at: '2026-08-02T10:00:00.000Z' });
check('ingresso non mutato', original[0].sets_log[0].done === false);

console.log(fails === 0 ? '\nTUTTI OK' : `\n${fails} FALLITI`);
process.exit(fails === 0 ? 0 : 1);
```

- [ ] **Step 2: Eseguirlo e verificare che fallisca**

```bash
cd /Users/gomutako/Developer/gym && node scripts/tmp-merge.mjs
```

Atteso: `ERR_MODULE_NOT_FOUND` su `session-merge.js`.

- [ ] **Step 3: Implementare il modulo**

`frontend/src/lib/session-merge.js`:

```js
// =====================================================
// Fusione dello stato di una sessione fra iPhone e Watch.
//
// Una serie completata è un FATTO con un timestamp, quindi la fusione è
// l'unione delle serie fatte, non una sovrascrittura. Tre regole:
//
//  1. `done` vince su non-`done` — rifare la stessa serie non significa nulla.
//  2. Se entrambi la riportano fatta, vince il `done_at` PIÙ VECCHIO con i
//     suoi valori: è il momento in cui la serie è realmente stata eseguita.
//  3. L'annullamento (`done: false`) è un'operazione SOLO iPhone e non passa
//     mai di qui, così non esiste un caso in cui i due lati si contraddicono
//     su un fatto già accaduto.
//
// Il timer di recupero NON è uno stato da fondere: è la scadenza derivata
// `done_at + rest_seconds`, che i due dispositivi calcolano identica.
//
// ⚠️ Queste tre regole sono replicate in Swift nel SessionStore del Watch.
// Modificandole qui vanno modificate anche lì, e i casi di prova sono gli
// stessi da entrambe le parti.
// =====================================================

/**
 * Applica un evento "serie completata" al log, senza mutare l'ingresso.
 *
 * @param {Array} exercisesLog  il log della sessione
 * @param {{uid: string, reps: number|null, load: number|null,
 *          incline?: number|null, done_at: string}} event
 * @returns {{ log: Array, changed: boolean }} `changed` false significa che
 *   l'evento non ha aggiunto nulla: il chiamante non deve persistere né
 *   ritrasmettere, altrimenti due dispositivi si rimbalzano lo stesso fatto
 *   all'infinito.
 */
export function mergeSetDone(exercisesLog, event) {
  const eventTime = event?.done_at ? Date.parse(event.done_at) : NaN;
  // Un `done_at` mancante o non parsabile viene scartato qui: se passasse,
  // finirebbe scritto in una riga come fatto compiuto e nessun evento
  // successivo potrebbe più correggerlo (la riga "done" vincerebbe sempre
  // il confronto sottostante, valori corrotti compresi).
  if (!Array.isArray(exercisesLog) || !event?.uid || Number.isNaN(eventTime)) {
    return { log: exercisesLog, changed: false };
  }

  let changed = false;
  const log = exercisesLog.map((ex) => {
    const sets = ex.sets_log || [];
    const i = sets.findIndex((r) => r.uid === event.uid);
    if (i < 0) return ex;

    const row = sets[i];
    if (row.done) {
      const rowTime = Date.parse(row.done_at);
      // Regola 2: chi è arrivato prima nel tempo REALE vince, non chi ha
      // parlato per ultimo. L'evento qui è già garantito valido dalla
      // guardia d'ingresso sopra. Una riga "done" con `done_at` mancante o
      // non parsabile (`rowTime` NaN) non ha invece nessuna pretesa
      // difendibile di vincere: se la lasciassimo vincere per il solito
      // "confronto con NaN è falso", una riga corrotta resterebbe bloccata
      // per sempre. Un evento valido la corregge sempre.
      if (!Number.isNaN(rowTime) && !(eventTime < rowTime)) {
        return ex;
      }
    }

    changed = true;
    const merged = {
      ...row,
      reps: event.reps ?? null,
      load: event.load ?? null,
      done: true,
      done_at: event.done_at,
    };
    // `incline` esiste solo per gli esercizi che la prevedono: non va
    // introdotta dove non c'era, o la riga cambia forma a metà sessione.
    if (event.incline !== undefined) merged.incline = event.incline;

    const sets_log = [...sets];
    sets_log[i] = merged;
    return { ...ex, sets_log };
  });

  return changed ? { log, changed: true } : { log: exercisesLog, changed: false };
}
```

- [ ] **Step 4: Eseguire e verificare che passi**

```bash
cd /Users/gomutako/Developer/gym && node scripts/tmp-merge.mjs
```

Atteso: tredici righe `OK` e `TUTTI OK`, uscita 0.

- [ ] **Step 5: Rimuovere lo script e committare**

```bash
cd /Users/gomutako/Developer/gym && rm scripts/tmp-merge.mjs
git add frontend/src/lib/session-merge.js
git commit -m "feat(sessions): fusione delle serie completate come funzione pura

Insieme accrescitivo con timestamp: done vince su non-done, il done_at più
vecchio vince, l'annullamento non attraversa il confine fra dispositivi.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `createSessionFromSnapshot()`

Materializza su Supabase una sessione nata al polso **senza rifare la precompilazione**: rifarla farebbe cambiare sotto gli occhi dell'utente numeri che aveva appena confermato.

**Files:**
- Modify: `frontend/src/lib/data/sessions.js` (aggiunta dopo `startSession`, riga 135)

**Interfaces:**
- Consumes: `client_session_id` (Task 2), gli `uid` sulle serie (Task 2).
- Produces: `createSessionFromSnapshot(snapshot, memberId) -> session`, dove `snapshot` è
  `{ client_session_id, workout_id, workout_title, day_index, day_name, exercises_log, started_at }`.

- [ ] **Step 1: Scrivere lo script di test che fallisce**

Creare `scripts/tmp-snapshot.mjs`:

```js
import { createClient } from '@supabase/supabase-js';
import { setDataClient } from '../frontend/src/lib/data/client.js';
import { createSessionFromSnapshot } from '../frontend/src/lib/data/sessions.js';

const client = createClient(process.env.SB_URL, process.env.SB_ANON);
setDataClient(client);
const { data: auth, error } = await client.auth.signInWithPassword({
  email: 'member@gym.local', password: 'password123',
});
if (error) throw error;
const memberId = auth.user.id;

const { data: workouts } = await client
  .from('workouts').select('id, title, days_json').eq('member_id', memberId).limit(1);
const w = workouts[0];

const clientSessionId = crypto.randomUUID();
const snapshot = {
  client_session_id: clientSessionId,
  workout_id: w.id,
  workout_title: w.title,
  day_index: 0,
  day_name: w.days_json[0].name,
  started_at: new Date(Date.now() - 600000).toISOString(),
  exercises_log: [{
    exercise_id: w.days_json[0].exercises[0].exercise_id,
    target_reps: 10, rest_seconds: 90, load_type: 'weight', has_incline: false,
    sets_log: [
      { uid: crypto.randomUUID(), reps: 12, load: 42.5, done: true,
        done_at: new Date().toISOString() },
    ],
  }],
};

const a = await createSessionFromSnapshot(snapshot, memberId);
console.log('creata:', a.id);
if (a.exercises_log[0].sets_log[0].load !== 42.5) {
  throw new Error('FALLITO: lo snapshot non è arrivato intatto');
}
if (a.started_at !== snapshot.started_at) {
  throw new Error('FALLITO: started_at non rispettato (il Watch aveva già iniziato)');
}

// Idempotenza: il buffer può essere svuotato due volte se l'app viene uccisa
const b = await createSessionFromSnapshot(snapshot, memberId);
console.log('secondo invio:', b.id);
if (b.id !== a.id) throw new Error('FALLITO: creata una sessione gemella');

console.log('OK');
await client.from('workout_sessions').delete().eq('id', a.id);
```

- [ ] **Step 2: Eseguirlo e verificare che fallisca**

```bash
cd /Users/gomutako/Developer/gym && SB_URL=<url> SB_ANON=<key> node scripts/tmp-snapshot.mjs
```

Atteso: `SyntaxError` / `does not provide an export named 'createSessionFromSnapshot'`.

- [ ] **Step 3: Implementare la funzione**

In `frontend/src/lib/data/sessions.js`, subito dopo `startSession` (riga 135):

```js
/**
 * Materializza una sessione già iniziata altrove (tipicamente sul Watch).
 *
 * A differenza di `startSession` NON precompila i carichi: lo snapshot arriva
 * già risolto. Rifare qui il calcolo farebbe cambiare sotto gli occhi
 * dell'utente numeri che aveva appena confermato al polso.
 *
 * È IDEMPOTENTE tramite `client_session_id`: il buffer del plugin nativo può
 * essere svuotato due volte — succede se l'app viene uccisa a metà — e due
 * sessioni gemelle sarebbero indistinguibili nello storico.
 */
export async function createSessionFromSnapshot(snapshot, memberId) {
  if (!snapshot?.client_session_id) {
    throw new Error('Sessione senza identificativo: impossibile importarla');
  }

  // La riga può già esistere: l'indice unico la garantisce singola, quindi
  // trovarla è sufficiente e non c'è corsa da difendere.
  const existing = unwrap(
    await db()
      .from('workout_sessions')
      .select('*')
      .eq('member_id', memberId)
      .eq('client_session_id', snapshot.client_session_id)
      .maybeSingle()
  );
  if (existing) return existing;

  return unwrap(
    await db()
      .from('workout_sessions')
      .insert({
        member_id: memberId,
        client_session_id: snapshot.client_session_id,
        workout_id: snapshot.workout_id ?? null,
        workout_title: snapshot.workout_title ?? null,
        day_index: snapshot.day_index ?? null,
        day_name: snapshot.day_name ?? null,
        exercises_log: snapshot.exercises_log ?? [],
        // L'allenamento è cominciato al polso, non adesso: il default now()
        // della colonna falserebbe durata e finestra dei biometrici.
        started_at: snapshot.started_at ?? new Date().toISOString(),
      })
      .select()
      .single(),
    MESSAGES
  );
}
```

- [ ] **Step 4: Eseguire e verificare che passi**

```bash
cd /Users/gomutako/Developer/gym && SB_URL=<url> SB_ANON=<key> node scripts/tmp-snapshot.mjs
```

Atteso: `OK`, con `secondo invio` uguale a `creata`.

- [ ] **Step 5: Rimuovere lo script e committare**

```bash
cd /Users/gomutako/Developer/gym && rm scripts/tmp-snapshot.mjs
git add frontend/src/lib/data/sessions.js
git commit -m "feat(sessions): createSessionFromSnapshot idempotente

Importa una sessione nata sul Watch senza rifare la precompilazione dei
carichi, che cambierebbe sotto gli occhi dell'utente numeri appena
confermati al polso.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Il canale — `PhoneLink` sul Watch, `WatchLink` sull'iPhone

Primo giro completo: i due dispositivi si parlano. Nessuna logica applicativa, solo il tubo e la sua verifica.

**Files:**
- Create: `frontend/ios/App/PalladeWatch Watch App/PhoneLink.swift`
- Create: `frontend/ios/App/App/WatchLinkPlugin.swift`
- Create: `frontend/ios/App/App/WatchLinkPlugin.m`
- Create: `frontend/src/lib/watch.js`
- Modify: `frontend/ios/App/App/ViewController.swift` (riga 21-25)
- Modify: `frontend/ios/App/PalladeWatch Watch App/ContentView.swift`

**Interfaces:**
- Consumes: il target watchOS (Task 1).
- Produces:
  - Swift Watch: `PhoneLink.shared.activate()`, `PhoneLink.shared.isReachable`, `PhoneLink.shared.send(_ payload: [String: Any], queued: Bool)`.
  - Plugin iOS `WatchLink`: metodi `isSupported()`, `getState()`, `send(payload)`; eventi `watchMessage`, `watchReachability`.
  - JS: `frontend/src/lib/watch.js` con `isSupported()`, `getState()`, `send(payload)`, `onMessage(cb)`.

- [ ] **Step 1: Scrivere `PhoneLink` sul Watch**

`frontend/ios/App/PalladeWatch Watch App/PhoneLink.swift`:

```swift
// =====================================================
// Unico punto di contatto del Watch con l'iPhone. Non sa nulla di HealthKit
// né di schede: riceve dizionari e li consegna a chi si è registrato.
//
// Due trasporti, scelti per una sola domanda: questo dato, se arriva in
// ritardo, vale ancora qualcosa?
//  - `transferUserInfo` (queued: true) — accodato, ordinato, sopravvive alla
//    app chiusa. Per le serie completate, che non possono andare perse.
//  - `sendMessage` (queued: false) — best effort, scartato se l'iPhone non è
//    raggiungibile. Per i biometrici: accodare un HR vecchio riempirebbe la
//    coda di valori inutili ritardando quelli veri.
// =====================================================
import Foundation
import WatchConnectivity

final class PhoneLink: NSObject, WCSessionDelegate, ObservableObject {
    static let shared = PhoneLink()

    @Published private(set) var isReachable = false
    @Published private(set) var isActivated = false

    /// Chiamato per ogni dizionario in arrivo dall'iPhone, sul main thread.
    var onMessage: (([String: Any]) -> Void)?

    private override init() { super.init() }

    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func send(_ payload: [String: Any], queued: Bool) {
        let session = WCSession.default
        guard session.activationState == .activated else { return }
        if queued {
            session.transferUserInfo(payload)
        } else if session.isReachable {
            session.sendMessage(payload, replyHandler: nil) { _ in
                // Best effort per definizione: un fallimento qui è un dato
                // che non valeva la pena consegnare in ritardo.
            }
        }
    }

    // MARK: - WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState,
                 error: Error?) {
        DispatchQueue.main.async {
            self.isActivated = (state == .activated)
            self.isReachable = session.isReachable
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async { self.isReachable = session.isReachable }
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        DispatchQueue.main.async { self.onMessage?(message) }
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        DispatchQueue.main.async { self.onMessage?(userInfo) }
    }

    func session(_ session: WCSession, didReceiveApplicationContext context: [String: Any]) {
        DispatchQueue.main.async { self.onMessage?(context) }
    }
}
```

- [ ] **Step 2: Scrivere il plugin iOS**

`frontend/ios/App/App/WatchLinkPlugin.swift`:

```swift
// =====================================================
// Unico punto di contatto dell'iPhone con il Watch, gemello di PhoneLink.
//
// La ragione per cui è nativo e non JS: quando il Watch invia qualcosa la
// WebView Capacitor è quasi sempre SOSPESA (schermo spento, telefono in
// tasca). Il risveglio concesso da WatchConnectivity sveglia il processo,
// non il JavaScript. Senza il buffer di questa classe ogni serie chiusa al
// polso a schermo spento andrebbe persa.
//
// Il buffer è anche su disco, non solo in memoria: iOS può terminare il
// processo fra un messaggio e l'apertura dell'app.
// =====================================================
import Foundation
import Capacitor
import WatchConnectivity

@objc(WatchLinkPlugin)
public class WatchLinkPlugin: CAPPlugin, WCSessionDelegate {
    private var buffer: [[String: Any]] = []
    private let bufferURL: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory,
                                           in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("watchlink-buffer.json")
    }()
    private let lock = NSLock()

    override public func load() {
        loadBuffer()
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    // MARK: - API verso il JS

    @objc func isSupported(_ call: CAPPluginCall) {
        call.resolve(["supported": WCSession.isSupported()])
    }

    /// Solo lo stato del collegamento. NON tocca il buffer: esiste separata da
    /// `getState` perché chi vuole sapere se il Watch c'è non deve, per farlo,
    /// buttare via messaggi che non ha intenzione di consumare.
    @objc func getLink(_ call: CAPPluginCall) {
        guard WCSession.isSupported() else {
            call.resolve([
                "supported": false, "paired": false,
                "installed": false, "reachable": false,
            ])
            return
        }
        let session = WCSession.default
        call.resolve([
            "supported": true,
            "paired": session.isPaired,
            "installed": session.isWatchAppInstalled,
            "reachable": session.isReachable,
        ])
    }

    /// Stato del collegamento + tutto ciò che è arrivato mentre la WebView
    /// dormiva. **Svuota il buffer**: il chiamante DEVE consumare `pending`.
    @objc func getState(_ call: CAPPluginCall) {
        guard WCSession.isSupported() else {
            call.resolve([
                "supported": false, "paired": false, "installed": false,
                "reachable": false, "pending": [],
            ])
            return
        }
        let session = WCSession.default
        call.resolve([
            "supported": true,
            "paired": session.isPaired,
            "installed": session.isWatchAppInstalled,
            "reachable": session.isReachable,
            "pending": drain(),
        ])
    }

    @objc func send(_ call: CAPPluginCall) {
        guard WCSession.isSupported(),
              WCSession.default.activationState == .activated else {
            call.reject("Watch non collegato")
            return
        }
        guard let payload = call.getObject("payload") else {
            call.reject("payload richiesto")
            return
        }
        let queued = call.getBool("queued") ?? true
        let session = WCSession.default

        if queued {
            session.transferUserInfo(payload)
            call.resolve()
        } else if session.isReachable {
            session.sendMessage(payload, replyHandler: nil) { error in
                CAPLog.print("⚡️ WatchLink: sendMessage fallito: \(error.localizedDescription)")
            }
            call.resolve()
        } else {
            // Non è un errore: il telefono può stare nell'armadietto. Chi
            // chiama deve sapere che il dato non è partito, non fermarsi.
            call.resolve(["skipped": true])
        }
    }

    /// Contesto applicativo: solo l'ultimo stato conta, semantica giusta per
    /// una cache. Non accoda nulla, quindi non c'è coda da smaltire.
    @objc func setContext(_ call: CAPPluginCall) {
        guard WCSession.isSupported(),
              WCSession.default.activationState == .activated,
              let payload = call.getObject("payload") else {
            call.reject("Watch non collegato")
            return
        }
        do {
            try WCSession.default.updateApplicationContext(payload)
            call.resolve()
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    // MARK: - Buffer

    private func store(_ message: [String: Any]) {
        lock.lock()
        buffer.append(message)
        // Un allenamento lungo con l'app iPhone mai aperta non deve far
        // crescere il file senza limite.
        if buffer.count > 500 { buffer.removeFirst(buffer.count - 500) }
        let snapshot = buffer
        lock.unlock()
        if let data = try? JSONSerialization.data(withJSONObject: snapshot) {
            try? data.write(to: bufferURL, options: .atomic)
        }
    }

    private func drain() -> [[String: Any]] {
        lock.lock()
        let out = buffer
        buffer = []
        lock.unlock()
        try? FileManager.default.removeItem(at: bufferURL)
        return out
    }

    private func loadBuffer() {
        guard let data = try? Data(contentsOf: bufferURL),
              let items = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else { return }
        lock.lock(); buffer = items; lock.unlock()
    }

    // MARK: - WCSessionDelegate

    public func session(_ session: WCSession,
                        activationDidCompleteWith state: WCSessionActivationState,
                        error: Error?) {
        CAPLog.print("⚡️ WatchLink: attivazione \(state.rawValue) err=\(error?.localizedDescription ?? "nessuno")")
    }

    // Obbligatori su iOS: l'utente può passare a un altro Watch, e senza la
    // riattivazione il canale resta muto fino al riavvio dell'app.
    public func sessionDidBecomeInactive(_ session: WCSession) {}
    public func sessionDidDeactivate(_ session: WCSession) { WCSession.default.activate() }

    public func sessionReachabilityDidChange(_ session: WCSession) {
        notifyListeners("watchReachability", data: ["reachable": session.isReachable])
    }

    public func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        deliver(message)
    }

    public func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        deliver(userInfo)
    }

    /// Se c'è un listener JS attivo consegna subito; altrimenti bufferizza.
    /// `retainUntilConsumed` non basta qui: gli eventi sono molti e ordinati,
    /// e vanno anche sopravvissuti alla terminazione del processo.
    private func deliver(_ message: [String: Any]) {
        if hasListeners("watchMessage") {
            notifyListeners("watchMessage", data: message)
        } else {
            store(message)
        }
    }
}
```

- [ ] **Step 3: Dichiarare il plugin e registrarlo**

`frontend/ios/App/App/WatchLinkPlugin.m`:

```objc
#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(WatchLinkPlugin, "WatchLink",
    CAP_PLUGIN_METHOD(isSupported, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(getLink, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(getState, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(send, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(setContext, CAPPluginReturnPromise);
)
```

In `frontend/ios/App/App/ViewController.swift`, dentro `capacitorDidLoad()` (righe 21-25):

```swift
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(HealthKitLivePlugin())
        bridge?.registerPluginInstance(NativeTabBarPlugin())
        bridge?.registerPluginInstance(RestTimerPlugin())
        bridge?.registerPluginInstance(WatchLinkPlugin())
    }
```

Senza questa riga ogni chiamata JS finisce in *"WatchLink plugin is not implemented on ios"* pur essendo la classe regolarmente compilata.

Aggiungere entrambi i file al target `App` in Xcode (trascinandoli nel navigator, spuntando *App* in Target Membership).

- [ ] **Step 4: Scrivere il wrapper web**

`frontend/src/lib/watch.js`:

```js
// =====================================================
// Wrapper platform-agnostic per il collegamento con l'Apple Watch.
// UNICA sorgente che la UI importa. Su browser/PWA: no-op, supported:false.
// Il plugin nativo `WatchLink` è in ios/App/App/WatchLinkPlugin.swift.
// =====================================================
import { Capacitor, registerPlugin } from '@capacitor/core';

const native = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
const WatchLink = registerPlugin('WatchLink');

export function isSupported() {
  return native;
}

// Solo lo stato del collegamento, senza toccare il buffer. È questa che va
// usata per decidere "c'è un Watch?".
export async function getLink() {
  if (!native) {
    return { supported: false, paired: false, installed: false, reachable: false };
  }
  return WatchLink.getLink();
}

/**
 * Stato del collegamento e messaggi arrivati mentre la WebView dormiva.
 * ⚠️ Chiamarla SVUOTA il buffer nativo: chi la chiama deve consumare
 * `pending`, altrimenti quei messaggi sono persi. Per il solo stato del
 * collegamento usare `getLink()`.
 */
export async function getState() {
  if (!native) {
    return { supported: false, paired: false, installed: false, reachable: false, pending: [] };
  }
  return WatchLink.getState();
}

// queued:true accoda (non va perso, sopravvive alla app chiusa);
// queued:false è best effort e viene scartato se il Watch non è raggiungibile.
export async function send(payload, { queued = true } = {}) {
  if (!native) return { skipped: true };
  return WatchLink.send({ payload, queued });
}

// Cache: solo l'ultimo stato conta, nessuna coda da smaltire.
export async function setContext(payload) {
  if (!native) return;
  await WatchLink.setContext({ payload });
}

// cb riceve il dizionario inviato dal Watch. Ritorna funzione di unsubscribe.
export function onMessage(cb) {
  if (!native) return () => {};
  const h = WatchLink.addListener('watchMessage', (e) => cb(e));
  return () => Promise.resolve(h).then((x) => x.remove?.());
}

export function onReachability(cb) {
  if (!native) return () => {};
  const h = WatchLink.addListener('watchReachability', (e) => cb(e.reachable));
  return () => Promise.resolve(h).then((x) => x.remove?.());
}
```

- [ ] **Step 5: Mostrare lo stato del canale sul Watch e provare il giro**

Sostituire `frontend/ios/App/PalladeWatch Watch App/ContentView.swift`:

```swift
import SwiftUI

struct ContentView: View {
    @StateObject private var link = PhoneLink.shared
    @State private var lastMessage = "—"

    var body: some View {
        VStack(spacing: 6) {
            Text("Pallade").font(.headline)
            Text(link.isReachable ? "iPhone raggiungibile" : "iPhone non raggiungibile")
                .font(.caption2)
                .foregroundStyle(link.isReachable ? .green : .secondary)
            Text(lastMessage).font(.caption2).lineLimit(2)
            Button("Ping") {
                PhoneLink.shared.send(["type": "ping", "at": ISO8601DateFormatter().string(from: Date())],
                                      queued: true)
            }
        }
        .onAppear {
            PhoneLink.shared.onMessage = { msg in
                lastMessage = (msg["type"] as? String) ?? "?"
            }
            PhoneLink.shared.activate()
        }
    }
}
```

- [ ] **Step 6: Verificare il giro completo sul device**

Ricostruire il bundle web e sincronizzare (i due comandi non terminano: verificare l'artefatto e chiudere per PID):

```bash
cd /Users/gomutako/Developer/gym && npm run build > /tmp/build.log 2>&1 &
sleep 90; ls -l frontend/dist/index.html; kill %1 2>/dev/null
cd /Users/gomutako/Developer/gym/frontend && npx cap sync ios > /tmp/sync.log 2>&1 &
sleep 60; ls -l /Users/gomutako/Developer/gym/frontend/ios/App/App/public/index.html; kill %1 2>/dev/null
```

Aggiungere **temporaneamente** in fondo a `frontend/src/main.js`, per poter guidare il plugin dalla console Safari (il bundle è minificato e i moduli non sono raggiungibili altrimenti):

```js
import * as watch from '@/lib/watch';
window.__watch = watch;
```

Ricostruire, sincronizzare, installare l'app iPhone e quella Watch, poi lanciare l'app iPhone con la console attaccata:

```bash
xcrun devicectl device process launch --device <UDID-IPHONE> --console it.pallade.app
```

Atteso all'avvio, nella console: `⚡️ WatchLink: attivazione 2 …`.

Sul Watch premere **Ping**. Poi da Safari (Sviluppo → iPhone → l'app) eseguire:

```js
await window.__watch.getState()
```

Atteso: `{ supported: true, paired: true, installed: true, reachable: …, pending: [ { type: "ping", at: … } ] }`. Il ping è nel buffer perché nessuna vista ha ancora registrato il listener — è esattamente il comportamento da dimostrare.

Poi, sempre da Safari:

```js
await window.__watch.send({ type: 'pong' }, { queued: true })
```

Atteso: sul Watch compare `pong`.

**Rimuovere le due righe da `main.js` prima del commit.**

- [ ] **Step 7: Commit**

```bash
cd /Users/gomutako/Developer/gym
git add frontend/ios/App frontend/src/lib/watch.js
git commit -m "feat(watch): canale WatchConnectivity con buffer nativo

Il plugin iOS bufferizza su disco: quando il Watch invia, la WebView è quasi
sempre sospesa e il risveglio sveglia il processo, non il JavaScript.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Cache delle schede iPhone → Watch e schermata di scelta

**Files:**
- Create: `frontend/src/lib/watch-catalog.js`
- Create: `frontend/ios/App/PalladeWatch Watch App/CatalogStore.swift`
- Create: `frontend/ios/App/PalladeWatch Watch App/PickerView.swift`
- Modify: `frontend/src/lib/data/sessions.js` (estrazione della precompilazione da `startSession`)
- Modify: `frontend/src/views/member/TrainingView.vue` (invio della cache all'apertura)
- Modify: `frontend/ios/App/PalladeWatch Watch App/ContentView.swift`

**Interfaces:**
- Consumes: `watch.setContext()` (Task 5), `startSession` (Task 2).
- Produces:
  - JS: `buildSnapshotLog(dayExercises, memberId)` esportata da `sessions.js`, e `pushCatalog(memberId)` da `watch-catalog.js`.
  - Swift: `CatalogStore.shared.workouts: [CachedWorkout]`, `CatalogStore.shared.syncedAt: Date?`.
  - Payload `catalog`: `{ type: "catalog", synced_at: ISO, workouts: [{ id, title, days: [{ index, name, exercises: [{ exercise_id, name, sets, reps, rest_seconds, load_type, has_incline, suggested: [{ reps, load, incline? }] }] }] }] }`

- [ ] **Step 1: Estrarre la precompilazione da `startSession`**

In `frontend/src/lib/data/sessions.js`, spostare le fasi 2-4 di `startSession` (righe 68-118) in una funzione esportata, e far sì che `startSession` la chiami. La firma:

```js
/**
 * Costruisce lo snapshot delle serie di una giornata, con reps e carichi
 * precompilati dall'ultima sessione completata che conteneva l'esercizio.
 *
 * Estratta da `startSession` perché serve anche a preparare la cache del
 * Watch: al polso i valori devono essere GIÀ risolti — il Watch non ha
 * credenziali Supabase e non può calcolarli.
 */
export async function buildSnapshotLog(dayExercises, memberId) {
  const exerciseIds = [...new Set(dayExercises.map((e) => e.exercise_id).filter(Boolean))];

  const metaById = {};
  if (exerciseIds.length) {
    const catalog = unwrap(
      await db().from('exercises').select('id, load_type, has_incline').in('id', exerciseIds)
    );
    for (const c of catalog || []) metaById[c.id] = c;
  }

  const past = unwrap(
    await db()
      .from('workout_sessions')
      .select('exercises_log, completed_at')
      .eq('member_id', memberId)
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(PAST_SESSIONS_LOOKBACK)
  );

  const lastSetsByExercise = {};
  for (const session of past || []) {
    for (const ex of session.exercises_log || []) {
      if (ex.exercise_id && !lastSetsByExercise[ex.exercise_id]) {
        lastSetsByExercise[ex.exercise_id] = ex.sets_log || [];
      }
    }
  }

  return dayExercises.map((e) => {
    const prev = lastSetsByExercise[e.exercise_id] || [];
    const nSets = Math.max(1, e.sets || 1);
    const hasIncline = metaById[e.exercise_id]?.has_incline || false;
    const sets_log = Array.from({ length: nSets }, (_, i) => ({
      uid: crypto.randomUUID(),
      reps: prev[i]?.reps ?? e.reps ?? null,
      load: prev[i]?.load ?? null,
      ...(hasIncline ? { incline: prev[i]?.incline ?? null } : {}),
      done: false,
    }));
    return {
      exercise_id: e.exercise_id,
      target_reps: e.reps ?? null,
      rest_seconds: e.rest_seconds ?? 0,
      load_type: metaById[e.exercise_id]?.load_type || 'weight',
      has_incline: hasIncline,
      sets_log,
    };
  });
}
```

E in `startSession`, sostituire le fasi 2-4 con:

```js
  const exercises_log = await buildSnapshotLog(dayExercises, memberId);
```

- [ ] **Step 2: Verificare che `startSession` non sia cambiata nel comportamento**

Ricreare `scripts/tmp-uid.mjs` dal Task 3 (Step 3 del Task 2) ed eseguirlo:

```bash
cd /Users/gomutako/Developer/gym && SB_URL=<url> SB_ANON=<key> node scripts/tmp-uid.mjs && rm scripts/tmp-uid.mjs
```

Atteso: `OK`. È una rifattorizzazione: se il test passa ancora, l'estrazione è corretta.

- [ ] **Step 3: Costruire e spingere la cache**

`frontend/src/lib/watch-catalog.js`:

```js
// =====================================================
// Cache delle schede spinta sul Watch.
//
// Il Watch non ha credenziali Supabase: i valori suggeriti devono arrivare
// GIÀ risolti. Il payload porta solo ciò che serve al polso — niente
// immagini, niente istruzioni, niente catalogo completo: passa da
// WatchConnectivity, non da una rete.
//
// Trasporto: updateApplicationContext, che conserva solo l'ultimo stato.
// È la semantica giusta per una cache e non lascia code da smaltire.
// =====================================================
import * as watch from '@/lib/watch';
import { listWorkoutsForMember } from '@/lib/data/workouts';
import { buildSnapshotLog } from '@/lib/data/sessions';
import { listExercisesBrief } from '@/lib/data/exercises';

export async function pushCatalog(memberId) {
  if (!watch.isSupported()) return { pushed: false, reason: 'non supportato' };

  // getLink e NON getState: quest'ultima svuota il buffer, e qui serve solo
  // sapere se il Watch c'è — scartare messaggi che non abbiamo intenzione di
  // consumare perderebbe le serie chiuse al polso.
  const state = await watch.getLink();
  if (!state.paired || !state.installed) {
    return { pushed: false, reason: 'app non installata sul Watch' };
  }

  const workouts = (await listWorkoutsForMember(memberId))
    .filter((w) => w.is_active && !w.archived);
  // Brief e non il catalogo intero: qui serve solo il nome, e le ~873 voci
  // complete con istruzioni e immagini sono egress sprecato.
  const catalog = await listExercisesBrief();
  const nameById = Object.fromEntries(catalog.map((e) => [e.id, e.name]));

  const payload = {
    type: 'catalog',
    synced_at: new Date().toISOString(),
    workouts: await Promise.all(workouts.map(async (w) => ({
      id: w.id,
      title: w.title,
      days: await Promise.all((w.days_json || []).map(async (day, index) => {
        const log = await buildSnapshotLog(day.exercises || [], memberId);
        return {
          index,
          name: day.name || `Giornata ${index + 1}`,
          exercises: log.map((ex) => ({
            exercise_id: ex.exercise_id,
            name: nameById[ex.exercise_id] || 'Esercizio',
            reps: ex.target_reps,
            rest_seconds: ex.rest_seconds,
            load_type: ex.load_type,
            has_incline: ex.has_incline,
            // Gli uid NON vengono spinti qui: la cache è un modello, non una
            // sessione. Gli uid definitivi nascono quando il Watch apre la
            // sessione, altrimenti due sessioni dalla stessa cache
            // condividerebbero le identità delle serie.
            suggested: ex.sets_log.map((r) => ({
              reps: r.reps, load: r.load,
              ...(ex.has_incline ? { incline: r.incline ?? null } : {}),
            })),
          })),
        };
      })),
    }))),
  };

  await watch.setContext(payload);
  return { pushed: true, workouts: payload.workouts.length };
}
```

- [ ] **Step 4: Spingere la cache quando il member apre l'allenamento**

In `frontend/src/views/member/TrainingView.vue` (`onMounted(load)` alla riga 304, quindi si innesta in `load()`), aggiungere l'import:

```js
import { pushCatalog } from '@/lib/watch-catalog';
```

e la chiamata dentro `load()` (righe 287-302), nel blocco `finally`, dopo `loading.value = false`:

```js
  } finally {
    loading.value = false;
    // La cache del Watch si aggiorna qui e non altrove: è l'unico punto in cui
    // il member ha appena visto le proprie schede, quindi ciò che finisce al
    // polso è ciò che ha davanti agli occhi. Non si attende e non si propaga
    // l'errore: il Watch è opzionale e non deve ritardare la schermata.
    pushCatalog(user.value.id).catch(() => {});
  }
```

La variabile è `user` (non `auth`): è così che la vista già legge l'utente alle righe 291-292.

- [ ] **Step 5: Ricevere e mostrare la cache sul Watch**

`frontend/ios/App/PalladeWatch Watch App/CatalogStore.swift`:

```swift
// =====================================================
// La cache delle schede ricevuta dall'iPhone. Sopravvive alla chiusura
// dell'app: senza persistenza, riaprire l'app in palestra con il telefono
// nell'armadietto mostrerebbe una lista vuota.
// =====================================================
import Foundation

struct CachedSuggestion: Codable, Hashable {
    var reps: Int?
    var load: Double?
    var incline: Double?
}

struct CachedExercise: Codable, Hashable {
    var exerciseId: String
    var name: String
    var reps: Int?
    var restSeconds: Int
    var loadType: String
    var hasIncline: Bool
    var suggested: [CachedSuggestion]
}

struct CachedDay: Codable, Hashable {
    var index: Int
    var name: String
    var exercises: [CachedExercise]
}

struct CachedWorkout: Codable, Hashable {
    var id: String
    var title: String
    var days: [CachedDay]
}

final class CatalogStore: ObservableObject {
    static let shared = CatalogStore()

    @Published private(set) var workouts: [CachedWorkout] = []
    @Published private(set) var syncedAt: Date?

    private let url: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory,
                                           in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("catalog.json")
    }()

    private init() { load() }

    /// Accetta il dizionario grezzo di WatchConnectivity. Ritorna false se il
    /// messaggio non è una cache: il chiamante smista, questa classe non
    /// indovina.
    @discardableResult
    func apply(_ message: [String: Any]) -> Bool {
        guard (message["type"] as? String) == "catalog",
              let raw = message["workouts"] as? [[String: Any]] else { return false }

        let parsed: [CachedWorkout] = raw.compactMap { w in
            guard let id = w["id"] as? String, let title = w["title"] as? String,
                  let days = w["days"] as? [[String: Any]] else { return nil }
            return CachedWorkout(id: id, title: title, days: days.compactMap { d in
                guard let index = d["index"] as? Int, let name = d["name"] as? String,
                      let exs = d["exercises"] as? [[String: Any]] else { return nil }
                return CachedDay(index: index, name: name, exercises: exs.compactMap { e in
                    guard let exId = e["exercise_id"] as? String,
                          let exName = e["name"] as? String else { return nil }
                    let sugg = (e["suggested"] as? [[String: Any]] ?? []).map {
                        CachedSuggestion(reps: $0["reps"] as? Int,
                                         load: $0["load"] as? Double,
                                         incline: $0["incline"] as? Double)
                    }
                    return CachedExercise(
                        exerciseId: exId, name: exName, reps: e["reps"] as? Int,
                        restSeconds: e["rest_seconds"] as? Int ?? 0,
                        loadType: e["load_type"] as? String ?? "weight",
                        hasIncline: e["has_incline"] as? Bool ?? false,
                        suggested: sugg)
                })
            })
        }

        let stamp = (message["synced_at"] as? String)
            .flatMap { ISO8601DateFormatter().date(from: $0) } ?? Date()

        DispatchQueue.main.async {
            self.workouts = parsed
            self.syncedAt = stamp
            self.persist()
        }
        return true
    }

    private func persist() {
        guard let data = try? JSONEncoder().encode(workouts) else { return }
        try? data.write(to: url, options: .atomic)
        UserDefaults.standard.set(syncedAt, forKey: "catalogSyncedAt")
    }

    private func load() {
        if let data = try? Data(contentsOf: url),
           let items = try? JSONDecoder().decode([CachedWorkout].self, from: data) {
            workouts = items
        }
        syncedAt = UserDefaults.standard.object(forKey: "catalogSyncedAt") as? Date
    }
}
```

- [ ] **Step 6: Schermata di scelta al polso**

`frontend/ios/App/PalladeWatch Watch App/PickerView.swift`:

```swift
import SwiftUI

struct PickerView: View {
    @StateObject private var catalog = CatalogStore.shared
    /// Invocata con la giornata scelta. Chi la consuma apre la sessione:
    /// questa vista non sa nulla di HealthKit.
    var onPick: (CachedWorkout, CachedDay) -> Void

    var body: some View {
        if catalog.workouts.isEmpty {
            VStack(spacing: 8) {
                Text("Nessuna scheda").font(.headline)
                Text("Apri Pallade sull'iPhone per sincronizzare le schede.")
                    .font(.caption2).multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
            }
        } else {
            List {
                ForEach(catalog.workouts, id: \.id) { w in
                    Section(w.title) {
                        ForEach(w.days, id: \.index) { d in
                            Button {
                                onPick(w, d)
                            } label: {
                                VStack(alignment: .leading) {
                                    Text(d.name)
                                    Text("\(d.exercises.count) esercizi")
                                        .font(.caption2).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
                if let at = catalog.syncedAt {
                    Text("Aggiornato \(at.formatted(date: .abbreviated, time: .shortened))")
                        .font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
    }
}
```

In `ContentView.swift`, sostituire il corpo con `PickerView` e smistare i messaggi al `CatalogStore`:

```swift
import SwiftUI

struct ContentView: View {
    var body: some View {
        PickerView { workout, day in
            print("scelta: \(workout.title) / \(day.name)")
        }
        .onAppear {
            PhoneLink.shared.onMessage = { msg in
                CatalogStore.shared.apply(msg)
            }
            PhoneLink.shared.activate()
        }
    }
}
```

- [ ] **Step 7: Verificare sul device**

Ricostruire, sincronizzare, installare entrambe le app (comandi del Task 5 Step 6). Sull'iPhone entrare come member e aprire la schermata Allenamento. Poi aprire l'app sul Watch.

Atteso: al polso compare la lista delle schede attive con le giornate e il conteggio esercizi, e in fondo la data di sincronizzazione. Toccando una giornata, nella console Xcode del Watch compare `scelta: …`.

Verifica del caso limite: chiudere l'app iPhone (force quit), riavviare l'app Watch. Atteso: la lista è ancora lì (persistenza), con la stessa data.

- [ ] **Step 8: Commit**

```bash
cd /Users/gomutako/Developer/gym
git add frontend/src/lib/watch-catalog.js frontend/src/lib/data/sessions.js frontend/src/views/member/TrainingView.vue frontend/ios/App
git commit -m "feat(watch): cache delle schede al polso con valori pre-risolti

Il Watch non ha credenziali Supabase: i suggerimenti devono arrivare già
calcolati. La precompilazione viene estratta da startSession e riusata.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: `WorkoutController` — la sessione HealthKit e la frequenza cardiaca live

Il cuore del progetto: da qui in poi l'app vive in background e ha i sensori.

**Files:**
- Create: `frontend/ios/App/PalladeWatch Watch App/WorkoutController.swift`
- Modify: `frontend/ios/App/PalladeWatch Watch App/ContentView.swift`

**Interfaces:**
- Consumes: gli entitlement HealthKit e `WKBackgroundModes` (Task 1).
- Produces: `WorkoutController.shared` con `start() async throws`, `end() async`, `@Published heartRate: Int?`, `@Published activeKcal: Double?`, `@Published state: WorkoutController.State`.

- [ ] **Step 1: Scrivere il controller**

`frontend/ios/App/PalladeWatch Watch App/WorkoutController.swift`:

```swift
// =====================================================
// Possiede la HKWorkoutSession. È l'UNICO a parlare con HealthKit: non sa
// nulla di schede, serie o iPhone.
//
// Aprire questa sessione è ciò che rende l'app viva in background — è
// l'unico meccanismo che watchOS offre per l'esecuzione continua e i
// sensori (background mode `workout-processing`). Senza, l'app viene
// sospesa appena si abbassa il polso.
//
// ⚠️ Su Apple Watch esiste UNA sola sessione di allenamento attiva alla
// volta, di sistema: se l'utente ha un allenamento aperto nell'app
// Allenamento, `startActivity` può non tornare mai (difetto storico, vedi
// rdar://45703316). Di qui il timeout esplicito in `start()`.
// =====================================================
import Foundation
import HealthKit

@MainActor
final class WorkoutController: NSObject, ObservableObject {
    static let shared = WorkoutController()

    enum State: Equatable {
        case idle
        case running
        case ended
        case failed(String)
    }

    @Published private(set) var state: State = .idle
    @Published private(set) var heartRate: Int?
    @Published private(set) var activeKcal: Double?

    private let store = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?

    private let hrType = HKQuantityType.quantityType(forIdentifier: .heartRate)!
    private let enType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!

    /// Chiede i permessi. Non rivela se la LETTURA è stata concessa (Apple non
    /// lo espone, per privacy): l'esito riguarda la scrittura del workout, che
    /// è ciò che serve per aprire la sessione.
    func requestAuth() async -> Bool {
        guard HKHealthStore.isHealthDataAvailable() else { return false }
        do {
            try await store.requestAuthorization(
                toShare: [HKQuantityType.workoutType()],
                read: [hrType, enType])
            return store.authorizationStatus(for: HKQuantityType.workoutType())
                == .sharingAuthorized
        } catch {
            return false
        }
    }

    func start() async throws {
        guard state != .running else { return }

        let config = HKWorkoutConfiguration()
        config.activityType = .traditionalStrengthTraining
        config.locationType = .indoor

        let session = try HKWorkoutSession(healthStore: store, configuration: config)
        let builder = session.associatedWorkoutBuilder()
        builder.dataSource = HKLiveWorkoutDataSource(healthStore: store,
                                                     workoutConfiguration: config)
        session.delegate = self
        builder.delegate = self
        self.session = session
        self.builder = builder

        let start = Date()
        session.startActivity(with: start)

        // Il timeout esiste per il caso "allenamento già attivo altrove", in
        // cui l'avvio non torna né riesce: senza, la schermata resterebbe
        // bloccata per sempre senza spiegare nulla.
        try await withThrowingTaskGroup(of: Void.self) { group in
            group.addTask { try await builder.beginCollection(at: start) }
            group.addTask {
                try await Task.sleep(nanoseconds: 8_000_000_000)
                throw WorkoutError.timeout
            }
            try await group.next()
            group.cancelAll()
        }

        state = .running
    }

    func end() async {
        guard let session, let builder else { return }
        session.end()
        try? await builder.endCollection(at: Date())
        // Salva l'HKWorkout in Salute: anelli, calorie e cronologia Fitness
        // restano corretti come se avesse registrato l'app Allenamento, ed è
        // ciò che HealthKitLivePlugin.summary() rileggerà sull'iPhone.
        _ = try? await builder.finishWorkout()
        self.session = nil
        self.builder = nil
        state = .ended
    }

    enum WorkoutError: LocalizedError {
        case timeout
        var errorDescription: String? {
            "Sembra che tu abbia un allenamento attivo nell'app Allenamento: terminalo per continuare."
        }
    }
}

extension WorkoutController: HKWorkoutSessionDelegate {
    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession,
                                    didChangeTo toState: HKWorkoutSessionState,
                                    from fromState: HKWorkoutSessionState,
                                    date: Date) {
        Task { @MainActor in
            // Il sistema può terminare la nostra sessione se l'utente ne apre
            // un'altra: va notato, non subito in silenzio.
            if toState == .ended, self.state == .running { self.state = .ended }
        }
    }

    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession,
                                    didFailWithError error: Error) {
        Task { @MainActor in self.state = .failed(error.localizedDescription) }
    }
}

extension WorkoutController: HKLiveWorkoutBuilderDelegate {
    nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

    nonisolated func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder,
                                    didCollectDataOf collectedTypes: Set<HKSampleType>) {
        for type in collectedTypes {
            guard let quantityType = type as? HKQuantityType,
                  let stats = workoutBuilder.statistics(for: quantityType) else { continue }

            if quantityType == HKQuantityType.quantityType(forIdentifier: .heartRate) {
                let bpm = HKUnit.count().unitDivided(by: .minute())
                let value = stats.mostRecentQuantity()?.doubleValue(for: bpm)
                Task { @MainActor in
                    self.heartRate = value.map { Int($0.rounded()) }
                }
            } else if quantityType == HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned) {
                let value = stats.sumQuantity()?.doubleValue(for: .kilocalorie())
                Task { @MainActor in self.activeKcal = value }
            }
        }
    }
}
```

- [ ] **Step 2: Collegare la scelta della giornata all'avvio della sessione**

In `ContentView.swift`:

```swift
import SwiftUI

struct ContentView: View {
    @StateObject private var workout = WorkoutController.shared
    @State private var error: String?

    var body: some View {
        Group {
            switch workout.state {
            case .running:
                VStack(spacing: 4) {
                    Text(workout.heartRate.map { "\($0)" } ?? "—")
                        .font(.system(size: 44, weight: .semibold, design: .rounded))
                    Text("bpm").font(.caption2).foregroundStyle(.secondary)
                    Text(workout.activeKcal.map { String(format: "%.0f kcal", $0) } ?? "— kcal")
                        .font(.caption2).foregroundStyle(.secondary)
                    Button("Termina") { Task { await workout.end() } }
                }
            default:
                PickerView { _, _ in
                    Task {
                        guard await workout.requestAuth() else {
                            error = "Senza accesso a Salute non posso registrare l'allenamento."
                            return
                        }
                        do { try await workout.start() }
                        catch { self.error = error.localizedDescription }
                    }
                }
                .overlay(alignment: .bottom) {
                    if let error {
                        Text(error).font(.caption2).foregroundStyle(.red)
                            .multilineTextAlignment(.center)
                    }
                }
            }
        }
        .onAppear {
            PhoneLink.shared.onMessage = { CatalogStore.shared.apply($0) }
            PhoneLink.shared.activate()
        }
    }
}
```

- [ ] **Step 3: Verificare la frequenza cardiaca reale sul polso**

Ricostruire e installare la watch app. Sul Watch scegliere una giornata, concedere i permessi Salute quando richiesti.

Atteso, **sul Watch fisico** (il simulatore non ha sensore): entro ~10 secondi compare un valore bpm plausibile, che si aggiorna. Le calorie salgono lentamente.

- [ ] **Step 4: Verificare il background — è il punto del task**

Con la sessione avviata, **abbassare il polso** e lasciare lo schermo spento per 3 minuti. Poi rialzarlo.

Atteso: l'app è ancora nella schermata bpm (non è tornata al picker né è ripartita), e il valore si è aggiornato durante lo schermo spento. Se l'app è ripartita da capo, la sessione non era attiva: controllare `WKBackgroundModes` in `Info.plist`.

- [ ] **Step 5: Verificare l'aut-aut con l'app Allenamento**

Terminare l'allenamento nella nostra app. Avviare un allenamento qualsiasi nell'app **Allenamento** di Apple, poi tornare su Pallade e scegliere una giornata.

Atteso: entro 8 secondi compare *"Sembra che tu abbia un allenamento attivo nell'app Allenamento: terminalo per continuare."* invece di una schermata bloccata.

- [ ] **Step 6: Verificare che il workout finisca in Salute**

Terminare l'allenamento su Pallade, poi aprire l'app **Fitness** sull'iPhone.

Atteso: compare un allenamento *Allenamento di forza* con la durata giusta, calorie e frequenza cardiaca media. È la prova che gli anelli restano corretti pur non avendo usato l'app Allenamento.

- [ ] **Step 7: Commit**

```bash
cd /Users/gomutako/Developer/gym
git add frontend/ios/App
git commit -m "feat(watch): HKWorkoutSession con HR live e background

Aprire la sessione è l'unico modo di restare vivi a schermo spento su
watchOS. Timeout esplicito sull'avvio: con un allenamento già attivo
nell'app Allenamento la chiamata può non tornare mai.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Biometrici in tempo reale sull'iPhone

**Files:**
- Modify: `frontend/ios/App/PalladeWatch Watch App/WorkoutController.swift`
- Modify: `frontend/src/views/member/SessionView.vue` (blocco biometrici, righe 27-34 e il ciclo di vita alle righe 200-214)

**Interfaces:**
- Consumes: `PhoneLink.send(_:queued:)` (Task 5), `WorkoutController` (Task 7), `watch.onMessage` (Task 5).
- Produces: messaggio `{ type: "biometrics", hr: Int?, kcal: Double?, at: ISO }` dal Watch, non accodato.

- [ ] **Step 1: Inviare i biometrici dal Watch**

In `WorkoutController.swift`, dentro `workoutBuilder(_:didCollectDataOf:)`, dopo l'aggiornamento delle proprietà, aggiungere l'inoltro. Sostituire il corpo del metodo con:

```swift
    nonisolated func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder,
                                    didCollectDataOf collectedTypes: Set<HKSampleType>) {
        for type in collectedTypes {
            guard let quantityType = type as? HKQuantityType,
                  let stats = workoutBuilder.statistics(for: quantityType) else { continue }

            if quantityType == HKQuantityType.quantityType(forIdentifier: .heartRate) {
                let bpm = HKUnit.count().unitDivided(by: .minute())
                let value = stats.mostRecentQuantity()?.doubleValue(for: bpm)
                Task { @MainActor in
                    self.heartRate = value.map { Int($0.rounded()) }
                    self.publishBiometrics()
                }
            } else if quantityType == HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned) {
                let value = stats.sumQuantity()?.doubleValue(for: .kilocalorie())
                Task { @MainActor in
                    self.activeKcal = value
                    self.publishBiometrics()
                }
            }
        }
    }
```

E aggiungere alla classe:

```swift
    /// Inoltra i biometrici all'iPhone. NON accodati: un HR di trenta secondi
    /// fa non serve a nessuno, e accodarlo riempirebbe la coda ritardando i
    /// valori veri. Se il telefono è nell'armadietto il dato si perde e va
    /// bene: HealthKit lo registra comunque nel workout.
    private var lastPublish = Date.distantPast

    private func publishBiometrics() {
        // Un campione al secondo basta a un badge: senza freno il builder può
        // chiamare più volte per lo stesso istante.
        guard Date().timeIntervalSince(lastPublish) > 1 else { return }
        lastPublish = Date()
        PhoneLink.shared.send([
            "type": "biometrics",
            "hr": heartRate as Any,
            "kcal": activeKcal as Any,
            "at": ISO8601DateFormatter().string(from: Date()),
        ], queued: false)
    }
```

- [ ] **Step 2: Consumarli su `SessionView`**

In `frontend/src/views/member/SessionView.vue`, aggiungere l'import accanto a quello di healthkit (riga 11):

```js
import * as watch from '@/lib/watch';
```

Dopo le variabili biometriche esistenti (riga 34), aggiungere:

```js
// Sorgente dei biometrici. Il Watch, quando c'è, vince su HealthKit: legge
// dal sensore in presa diretta (<1s) invece di aspettare che i campioni
// vengano sincronizzati sul telefono (da pochi a decine di secondi).
const watchLive = ref(false);
let watchUnsub = null;
```

E dentro `onMounted`, dopo l'avvio di HealthKit:

```js
  if (watch.isSupported()) {
    watchUnsub = watch.onMessage((msg) => {
      if (msg?.type !== 'biometrics') return;
      watchLive.value = true;
      if (msg.hr != null) liveHR.value = msg.hr;
      if (msg.kcal != null) liveKcal.value = msg.kcal;
      lastSampleAt.value = Date.now();
    });
  }
```

In `onUnmounted` (righe 208-214), aggiungere prima della chiusura:

```js
  if (watchUnsub) watchUnsub();
```

- [ ] **Step 3: Mostrare da dove vengono i dati**

Nel template, accanto al badge della frequenza cardiaca, aggiungere l'indicatore di sorgente. Cercare il badge HR esistente e aggiungere subito dopo il valore:

```html
<span v-if="watchLive" class="text-[10px] text-emerald-600">Watch</span>
```

Serve perché un HR aggiornato al secondo e uno aggiornato ogni venti sono indistinguibili guardando un numero: senza l'indicatore non c'è modo di sapere se il collegamento sta funzionando.

- [ ] **Step 4: Verificare la latenza sul device**

Ricostruire il web (`npm run build`), sincronizzare, installare entrambe le app. Avviare una sessione dall'iPhone, poi avviare l'allenamento sul Watch, poi tornare all'app iPhone tenendola in primo piano.

Atteso: il badge HR mostra "Watch" e il numero cambia **circa una volta al secondo**. Fare qualche flessione: il valore deve salire entro un paio di secondi, non entro mezzo minuto.

- [ ] **Step 5: Verificare la degradazione**

Terminare l'allenamento sul Watch (senza chiudere la sessione sull'iPhone).

Atteso: il badge smette di dire "Watch" ai successivi aggiornamenti e la schermata continua a funzionare con i dati HealthKit. Nessun errore a schermo.

- [ ] **Step 6: Commit**

```bash
cd /Users/gomutako/Developer/gym
git add frontend/ios/App frontend/src/views/member/SessionView.vue
git commit -m "feat(watch): biometrici in tempo reale sull'iPhone

Non accodati di proposito: un HR in ritardo non vale niente e riempirebbe
la coda ritardando i valori veri.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Esecuzione al polso — `SessionStore`, "fatto" e recupero

**Files:**
- Create: `frontend/ios/App/PalladeWatch Watch App/SessionStore.swift`
- Create: `frontend/ios/App/PalladeWatch Watch App/ExecutionView.swift`
- Create: `frontend/ios/App/PalladeWatch Watch App/RestNotifier.swift`
- Modify: `frontend/ios/App/PalladeWatch Watch App/ContentView.swift`
- Modify: `frontend/ios/App/PalladeWatch Watch App/Info.plist`

**Interfaces:**
- Consumes: `CatalogStore` (Task 6), `WorkoutController` (Task 7).
- Produces: `SessionStore.shared` con `begin(workout:day:)`, `markDone(uid:)`, `apply(_ message:) -> Bool`, `@Published snapshot: LiveSession?`, `restDeadline(for:) -> Date?`.

- [ ] **Step 1: Chiedere il permesso notifiche nell'`Info.plist` del Watch**

Nessuna chiave serve per le notifiche locali, ma va aggiunta la schermata al target: verificare che in `Info.plist` non ci sia `WKWatchOnly` impostato a `true` (l'app dipende dall'iPhone).

- [ ] **Step 2: Scrivere il notificatore di fine recupero**

`frontend/ios/App/PalladeWatch Watch App/RestNotifier.swift`:

```swift
// =====================================================
// Avviso di fine recupero al polso.
//
// Si usa una notifica locale e non un Timer con háptica diretta: durante un
// workout l'app resta viva, ma `WKInterfaceDevice.play` in background non è
// garantito, mentre una notifica programmata suona e vibra qualunque sia lo
// stato dell'app. È lo stesso meccanismo già collaudato sull'iPhone in
// RestTimerPlugin, quindi la semantica fra i due dispositivi coincide.
//
// Ne esiste UNA sola alla volta (id costante): riprogrammare sostituisce la
// pendente, che è il comportamento voluto quando si chiude una seconda serie.
// =====================================================
import Foundation
import UserNotifications

enum RestNotifier {
    private static let identifier = "rest-timer-watch"

    static func requestPermission() async -> Bool {
        (try? await UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .sound])) ?? false
    }

    static func schedule(seconds: TimeInterval, body: String) {
        guard seconds > 0 else { return }
        let content = UNMutableNotificationContent()
        content.title = "Recupero terminato"
        content.body = body
        content.sound = .default
        content.interruptionLevel = .timeSensitive

        let request = UNNotificationRequest(
            identifier: identifier, content: content,
            trigger: UNTimeIntervalNotificationTrigger(timeInterval: seconds, repeats: false))

        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [identifier])
        center.removeDeliveredNotifications(withIdentifiers: [identifier])
        center.add(request)
    }

    static func cancel() {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [identifier])
        center.removeDeliveredNotifications(withIdentifiers: [identifier])
    }
}
```

- [ ] **Step 3: Scrivere il `SessionStore` con la fusione replicata**

`frontend/ios/App/PalladeWatch Watch App/SessionStore.swift`:

```swift
// =====================================================
// Lo stato della sessione al polso e l'UNICO posto in cui avviene la fusione
// con ciò che arriva dall'iPhone.
//
// ⚠️ Le tre regole di `mergeSetDone` sono la replica esatta di
// frontend/src/lib/session-merge.js. Modificarne una qui senza modificarla
// là fa divergere i due dispositivi in modo silenzioso: i casi di prova sono
// gli stessi da entrambe le parti.
//
// Il timer di recupero NON è stato: è la scadenza derivata
// `done_at + rest_seconds`, che iPhone e Watch calcolano identica senza
// scambiarsi nulla. È anche ciò che lo rende immune alla sospensione.
// =====================================================
import Foundation

struct LiveSet: Codable, Hashable {
    var uid: String
    var reps: Int?
    var load: Double?
    var incline: Double?
    var done: Bool
    var doneAt: Date?
}

struct LiveExercise: Codable, Hashable {
    var exerciseId: String
    var name: String
    var restSeconds: Int
    var loadType: String
    var sets: [LiveSet]
}

struct LiveSession: Codable {
    var clientSessionId: String
    var workoutId: String
    var workoutTitle: String
    var dayIndex: Int
    var dayName: String
    var startedAt: Date
    var exercises: [LiveExercise]
}

@MainActor
final class SessionStore: ObservableObject {
    static let shared = SessionStore()

    @Published private(set) var session: LiveSession?

    private let url: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory,
                                           in: .userDomainMask)[0]
        return dir.appendingPathComponent("session.json")
    }()

    private init() {
        if let data = try? Data(contentsOf: url),
           let s = try? JSONDecoder().decode(LiveSession.self, from: data) {
            session = s
        }
    }

    // MARK: - Ciclo di vita

    /// Apre una sessione dalla cache. Gli uid nascono QUI e non nella cache:
    /// due sessioni costruite dallo stesso modello devono avere identità di
    /// serie distinte, altrimenti un "fatto" dell'una toccherebbe l'altra.
    func begin(workout: CachedWorkout, day: CachedDay) -> LiveSession {
        let s = LiveSession(
            clientSessionId: UUID().uuidString,
            workoutId: workout.id,
            workoutTitle: workout.title,
            dayIndex: day.index,
            dayName: day.name,
            startedAt: Date(),
            exercises: day.exercises.map { e in
                LiveExercise(
                    exerciseId: e.exerciseId, name: e.name,
                    restSeconds: e.restSeconds, loadType: e.loadType,
                    sets: e.suggested.map {
                        LiveSet(uid: UUID().uuidString, reps: $0.reps, load: $0.load,
                                incline: $0.incline, done: false, doneAt: nil)
                    })
            })
        session = s
        persist()
        return s
    }

    func close() {
        session = nil
        try? FileManager.default.removeItem(at: url)
        RestNotifier.cancel()
    }

    // MARK: - Fusione (replica di session-merge.js)

    /// Applica un "serie completata". Ritorna true solo se ha cambiato
    /// qualcosa: false significa che l'evento non va né persistito né
    /// ritrasmesso, altrimenti i due dispositivi si rimbalzerebbero lo
    /// stesso fatto all'infinito.
    @discardableResult
    func mergeSetDone(uid: String, reps: Int?, load: Double?, incline: Double?,
                      doneAt: Date) -> Bool {
        guard var s = session else { return false }
        for (ei, ex) in s.exercises.enumerated() {
            guard let si = ex.sets.firstIndex(where: { $0.uid == uid }) else { continue }
            let row = ex.sets[si]
            // Regola 2: vince chi è arrivato prima nel tempo reale.
            if row.done, let existing = row.doneAt, doneAt >= existing { return false }

            var updated = row
            updated.reps = reps
            updated.load = load
            if incline != nil { updated.incline = incline }
            updated.done = true
            updated.doneAt = doneAt
            s.exercises[ei].sets[si] = updated
            session = s
            persist()
            return true
        }
        return false
    }

    /// Smista un dizionario in arrivo dall'iPhone. Ritorna true se lo ha
    /// riconosciuto: chi chiama non deve indovinare.
    @discardableResult
    func apply(_ message: [String: Any]) -> Bool {
        guard (message["type"] as? String) == "set_done",
              let uid = message["uid"] as? String,
              let atString = message["done_at"] as? String,
              let at = ISO8601DateFormatter.withFraction.date(from: atString)
        else { return false }
        mergeSetDone(uid: uid, reps: message["reps"] as? Int,
                     load: message["load"] as? Double,
                     incline: message["incline"] as? Double, doneAt: at)
        return true
    }

    // MARK: - Recupero, derivato

    /// La scadenza del recupero di una serie. Non è memorizzata da nessuna
    /// parte: si ricalcola, quindi non può andare fuori sincrono e sopravvive
    /// alla sospensione dell'app.
    func restDeadline(exerciseIndex: Int, setUid: String) -> Date? {
        guard let s = session, s.exercises.indices.contains(exerciseIndex) else { return nil }
        let ex = s.exercises[exerciseIndex]
        guard let row = ex.sets.first(where: { $0.uid == setUid }),
              let at = row.doneAt, ex.restSeconds > 0 else { return nil }
        return at.addingTimeInterval(TimeInterval(ex.restSeconds))
    }

    private func persist() {
        guard let s = session, let data = try? JSONEncoder().encode(s) else { return }
        try? data.write(to: url, options: .atomic)
    }
}

extension ISO8601DateFormatter {
    /// I timestamp JS (`toISOString()`) hanno tre decimali; quelli PostgREST
    /// sei. Un formatter senza `.withFractionalSeconds` li rifiuta entrambi.
    static let withFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}
```

- [ ] **Step 4: Provare la fusione Swift sugli stessi casi di quella JS**

È l'unico modo di sapere che le due implementazioni concordano. Senza, una divergenza si manifesta come una serie che sparisce, mesi dopo, su un solo dispositivo.

Il bundle di test esiste già: è stato creato dal Task 1 scegliendo *XCTest for Unit and UI
Tests*. Individuarne la cartella nel progetto (si chiamerà `PalladeWatch Watch AppTests` o
simile, a seconda di come Xcode l'ha nominata) e usarla al posto del percorso qui sotto,
adeguando di conseguenza il nome del modulo in `@testable import`.

Creare `SessionMergeTests.swift` dentro quella cartella:

```swift
import XCTest
@testable import PalladeWatch_Watch_App

@MainActor
final class SessionMergeTests: XCTestCase {
    private let t0 = ISO8601DateFormatter.withFraction.date(from: "2026-08-02T10:00:00.000Z")!
    private let tLate = ISO8601DateFormatter.withFraction.date(from: "2026-08-02T10:05:00.000Z")!
    private let tEarly = ISO8601DateFormatter.withFraction.date(from: "2026-08-02T09:55:00.000Z")!

    private func makeStore() -> SessionStore {
        let store = SessionStore.shared
        store.close()
        let day = CachedDay(index: 0, name: "A", exercises: [
            CachedExercise(exerciseId: "e1", name: "Panca", reps: 10, restSeconds: 90,
                           loadType: "weight", hasIncline: false,
                           suggested: [CachedSuggestion(reps: 10, load: 50, incline: nil),
                                       CachedSuggestion(reps: 10, load: 50, incline: nil)]),
        ])
        _ = store.begin(workout: CachedWorkout(id: "w1", title: "Scheda", days: [day]), day: day)
        return store
    }

    func testMarcaLaSerieEApplicaIValori() {
        let store = makeStore()
        let uid = store.session!.exercises[0].sets[0].uid
        XCTAssertTrue(store.mergeSetDone(uid: uid, reps: 12, load: 55, incline: nil, doneAt: t0))
        XCTAssertTrue(store.session!.exercises[0].sets[0].done)
        XCTAssertEqual(store.session!.exercises[0].sets[0].reps, 12)
        XCTAssertEqual(store.session!.exercises[0].sets[0].load, 55)
        XCTAssertFalse(store.session!.exercises[0].sets[1].done, "non deve toccare le altre")
    }

    func testIdempotente() {
        let store = makeStore()
        let uid = store.session!.exercises[0].sets[0].uid
        _ = store.mergeSetDone(uid: uid, reps: 12, load: 55, incline: nil, doneAt: t0)
        XCTAssertFalse(store.mergeSetDone(uid: uid, reps: 12, load: 55, incline: nil, doneAt: t0))
    }

    func testIlPiuRecenteNonSovrascrive() {
        let store = makeStore()
        let uid = store.session!.exercises[0].sets[0].uid
        _ = store.mergeSetDone(uid: uid, reps: 12, load: 55, incline: nil, doneAt: t0)
        XCTAssertFalse(store.mergeSetDone(uid: uid, reps: 8, load: 40, incline: nil, doneAt: tLate))
        XCTAssertEqual(store.session!.exercises[0].sets[0].reps, 12)
    }

    func testIlPiuVecchioVince() {
        let store = makeStore()
        let uid = store.session!.exercises[0].sets[0].uid
        _ = store.mergeSetDone(uid: uid, reps: 12, load: 55, incline: nil, doneAt: t0)
        XCTAssertTrue(store.mergeSetDone(uid: uid, reps: 8, load: 40, incline: nil, doneAt: tEarly))
        XCTAssertEqual(store.session!.exercises[0].sets[0].reps, 8)
    }

    func testUidSconosciutoIgnorato() {
        let store = makeStore()
        XCTAssertFalse(store.mergeSetDone(uid: "zzz", reps: 1, load: 1, incline: nil, doneAt: t0))
    }

    func testScadenzaDelRecuperoDerivata() {
        let store = makeStore()
        let uid = store.session!.exercises[0].sets[0].uid
        _ = store.mergeSetDone(uid: uid, reps: 10, load: 50, incline: nil, doneAt: t0)
        // 90 secondi di recupero: la scadenza si RICALCOLA, non è memorizzata.
        XCTAssertEqual(store.restDeadline(exerciseIndex: 0, setUid: uid),
                       t0.addingTimeInterval(90))
    }

    func testUidDistintiFraSessioniDalloStessoModello() {
        let a = makeStore().session!.exercises[0].sets[0].uid
        let b = makeStore().session!.exercises[0].sets[0].uid
        XCTAssertNotEqual(a, b, "due sessioni dalla stessa cache devono avere identità distinte")
    }
}
```

Eseguirli:

```bash
cd /Users/gomutako/Developer/gym && xcodebuild test \
  -workspace frontend/ios/App/App.xcworkspace \
  -scheme 'PalladeWatch Watch App' \
  -destination 'platform=watchOS Simulator,name=Apple Watch Series 10 (46mm)' \
  2>&1 | grep -E 'Test Case|TEST (SUCCEEDED|FAILED)' | tail -20
```

Atteso: sette `Test Case … passed` e `TEST SUCCEEDED`. Se il nome del simulatore non esiste, elencarli con `xcrun simctl list devices available | grep Watch`.

Questi sono gli stessi casi di `scripts/tmp-merge.mjs` del Task 3: se uno passa da una parte e fallisce dall'altra, le due implementazioni sono divergenti.

- [ ] **Step 5: Scrivere la schermata di esecuzione**

`frontend/ios/App/PalladeWatch Watch App/ExecutionView.swift`:

```swift
import SwiftUI

struct ExecutionView: View {
    @StateObject private var store = SessionStore.shared
    @StateObject private var workout = WorkoutController.shared
    @State private var exerciseIndex = 0
    @State private var now = Date()
    var onFinish: () -> Void

    private let tick = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private var exercise: LiveExercise? {
        guard let s = store.session, s.exercises.indices.contains(exerciseIndex) else { return nil }
        return s.exercises[exerciseIndex]
    }

    /// La prima serie non ancora fatta: è quella che il tasto chiude.
    private var nextSet: LiveSet? { exercise?.sets.first(where: { !$0.done }) }

    private var restRemaining: Int? {
        guard let ex = exercise,
              let last = ex.sets.filter({ $0.done }).max(by: { ($0.doneAt ?? .distantPast) < ($1.doneAt ?? .distantPast) }),
              let deadline = store.restDeadline(exerciseIndex: exerciseIndex, setUid: last.uid)
        else { return nil }
        let left = Int(deadline.timeIntervalSince(now).rounded(.up))
        return left > 0 ? left : nil
    }

    var body: some View {
        TabView(selection: $exerciseIndex) {
            ForEach(Array((store.session?.exercises ?? []).enumerated()), id: \.offset) { i, ex in
                VStack(spacing: 4) {
                    Text(ex.name).font(.caption).lineLimit(2).multilineTextAlignment(.center)
                    Text("\(ex.sets.filter { $0.done }.count)/\(ex.sets.count) serie")
                        .font(.caption2).foregroundStyle(.secondary)

                    if let left = restRemaining, i == exerciseIndex {
                        Text("\(left / 60):\(String(format: "%02d", left % 60))")
                            .font(.system(size: 34, weight: .semibold, design: .rounded))
                            .foregroundStyle(.orange)
                        Text("recupero").font(.caption2).foregroundStyle(.secondary)
                    } else if let set = nextSet, i == exerciseIndex {
                        Text(setLabel(ex: ex, set: set))
                            .font(.system(size: 24, weight: .semibold, design: .rounded))
                        Button("Fatto") { markDone(ex: ex, set: set) }
                            .tint(.green)
                    } else {
                        Text("Completato").font(.caption2).foregroundStyle(.green)
                    }

                    HStack(spacing: 6) {
                        Text(workout.heartRate.map { "\($0) bpm" } ?? "— bpm")
                        Text(workout.activeKcal.map { String(format: "%.0f kcal", $0) } ?? "")
                    }
                    .font(.caption2).foregroundStyle(.secondary)
                }
                .tag(i)
            }
        }
        .tabViewStyle(.verticalPage)
        .onReceive(tick) { now = $0 }
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Fine") { onFinish() }
            }
        }
    }

    private func setLabel(ex: LiveExercise, set: LiveSet) -> String {
        let reps = set.reps.map(String.init) ?? "—"
        guard let load = set.load else { return "\(reps) rip" }
        return ex.loadType == "level"
            ? "\(reps) × liv \(Int(load))"
            : "\(reps) × \(load.formatted(.number.precision(.fractionLength(0...1)))) kg"
    }

    private func markDone(ex: LiveExercise, set: LiveSet) {
        let at = Date()
        guard store.mergeSetDone(uid: set.uid, reps: set.reps, load: set.load,
                                 incline: set.incline, doneAt: at) else { return }
        if ex.restSeconds > 0 {
            RestNotifier.schedule(seconds: TimeInterval(ex.restSeconds),
                                  body: "\(ex.name) — pronto per la serie successiva")
        }
    }
}
```

- [ ] **Step 6: Collegare picker → esecuzione**

In `ContentView.swift`, sostituire il ramo `.running` con `ExecutionView`, e chiedere il permesso notifiche all'avvio della sessione (non al primo "fatto": chiederlo lì ritarderebbe la prima notifica proprio quando serve):

```swift
import SwiftUI

struct ContentView: View {
    @StateObject private var workout = WorkoutController.shared
    @StateObject private var store = SessionStore.shared
    @State private var error: String?

    var body: some View {
        Group {
            if workout.state == .running, store.session != nil {
                ExecutionView {
                    Task {
                        await workout.end()
                        store.close()
                    }
                }
            } else {
                PickerView { w, d in
                    Task {
                        guard await workout.requestAuth() else {
                            error = "Senza accesso a Salute non posso registrare l'allenamento."
                            return
                        }
                        _ = await RestNotifier.requestPermission()
                        _ = store.begin(workout: w, day: d)
                        do { try await workout.start() }
                        catch {
                            store.close()
                            self.error = error.localizedDescription
                        }
                    }
                }
                .overlay(alignment: .bottom) {
                    if let error {
                        Text(error).font(.caption2).foregroundStyle(.red)
                            .multilineTextAlignment(.center)
                    }
                }
            }
        }
        .onAppear {
            PhoneLink.shared.onMessage = { msg in
                if CatalogStore.shared.apply(msg) { return }
                Task { @MainActor in SessionStore.shared.apply(msg) }
            }
            PhoneLink.shared.activate()
        }
    }
}
```

- [ ] **Step 7: Provare un allenamento intero al polso**

Installare la watch app. Scegliere una giornata, concedere permessi Salute e notifiche.

Atteso:
1. Compare il primo esercizio con "N × M kg" e il tasto Fatto.
2. Premendo Fatto parte il countdown arancione.
3. **Abbassando il polso**, alla scadenza il Watch vibra e mostra la notifica "Recupero terminato".
4. Rialzando il polso, l'app è dove l'avevi lasciata e il conteggio serie è aggiornato.
5. Scorrendo verticalmente si passa agli altri esercizi.
6. "Fine" chiude e il workout compare in Fitness.

- [ ] **Step 8: Verificare la persistenza allo spegnimento**

A metà allenamento, forzare la chiusura dell'app dal Watch (tenere premuto il tasto laterale → non serve: premere la Digital Crown e riaprire l'app dal dock). Riaprire Pallade.

Atteso: la sessione è ancora aperta con le serie già fatte contate correttamente.

- [ ] **Step 9: Commit**

```bash
cd /Users/gomutako/Developer/gym
git add frontend/ios/App
git commit -m "feat(watch): esecuzione al polso con recupero e notifica

Fusione replicata da session-merge.js; il recupero è una scadenza derivata
e non uno stato, quindi non va fuori sincrono con l'iPhone.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Sincronizzazione del "fatto" nei due versi e materializzazione su Supabase

**Files:**
- Create: `frontend/src/lib/watch-session.js`
- Modify: `frontend/ios/App/PalladeWatch Watch App/ExecutionView.swift`
- Modify: `frontend/ios/App/PalladeWatch Watch App/ContentView.swift`
- Modify: `frontend/src/views/member/SessionView.vue`
- Modify: `frontend/src/views/member/TrainingView.vue`

**Interfaces:**
- Consumes: `mergeSetDone` (Task 3), `createSessionFromSnapshot` (Task 4), `watch.send`/`onMessage`/`getState` (Task 5), `SessionStore` (Task 9).
- Produces:
  - Messaggi `session_started` `{ type, client_session_id, workout_id, workout_title, day_index, day_name, started_at, exercises_log }`, `set_done` `{ type, client_session_id, uid, reps, load, incline?, done_at }`, `session_closed` `{ type, client_session_id, completed_at }`.
  - JS: `drainWatchMessages(memberId)` da `watch-session.js`, che ritorna `{ sessionId | null }`.

- [ ] **Step 1: Inviare gli eventi dal Watch**

In `ExecutionView.swift`, dentro `markDone`, dopo la programmazione della notifica:

```swift
        PhoneLink.shared.send([
            "type": "set_done",
            "client_session_id": store.session?.clientSessionId ?? "",
            "uid": set.uid,
            "reps": set.reps as Any,
            "load": set.load as Any,
            "incline": set.incline as Any,
            "done_at": ISO8601DateFormatter.withFraction.string(from: at),
        ], queued: true)
```

`queued: true` perché una serie chiusa non può andare persa: il telefono può stare nell'armadietto per l'intero allenamento.

In `ContentView.swift`, dopo `store.begin(...)`, inviare l'apertura, e nel blocco "Fine" la chiusura. Sostituire la chiamata a `begin` con:

```swift
                        let live = store.begin(workout: w, day: d)
                        PhoneLink.shared.send(sessionStartedPayload(live), queued: true)
```

E aggiungere in fondo al file:

```swift
/// Snapshot completo per l'iPhone. Deve bastare a creare la riga Supabase da
/// solo: l'app iPhone potrebbe non essere mai stata aperta durante
/// l'allenamento.
private func sessionStartedPayload(_ s: LiveSession) -> [String: Any] {
    [
        "type": "session_started",
        "client_session_id": s.clientSessionId,
        "workout_id": s.workoutId,
        "workout_title": s.workoutTitle,
        "day_index": s.dayIndex,
        "day_name": s.dayName,
        "started_at": ISO8601DateFormatter.withFraction.string(from: s.startedAt),
        "exercises_log": s.exercises.map { ex in
            [
                "exercise_id": ex.exerciseId,
                "rest_seconds": ex.restSeconds,
                "load_type": ex.loadType,
                "sets_log": ex.sets.map { r -> [String: Any] in
                    var row: [String: Any] = [
                        "uid": r.uid, "reps": r.reps as Any,
                        "load": r.load as Any, "done": r.done,
                    ]
                    if let inc = r.incline { row["incline"] = inc }
                    return row
                },
            ] as [String: Any]
        },
    ]
}
```

Nel ramo "Fine" di `ExecutionView`, prima di `store.close()`:

```swift
                ExecutionView {
                    Task {
                        let id = store.session?.clientSessionId ?? ""
                        await workout.end()
                        PhoneLink.shared.send([
                            "type": "session_closed",
                            "client_session_id": id,
                            "completed_at": ISO8601DateFormatter.withFraction.string(from: Date()),
                        ], queued: true)
                        store.close()
                    }
                }
```

- [ ] **Step 2: Consumare gli eventi sull'iPhone**

`frontend/src/lib/watch-session.js`:

```js
// =====================================================
// Consuma i messaggi accumulati dal Watch e li riversa su Supabase.
//
// Perché esiste come modulo a sé: la materializzazione può avvenire in due
// posti diversi (la lista allenamenti o la sessione aperta) e in momenti
// imprevedibili — l'app iPhone può essere stata chiusa per tutto
// l'allenamento. La logica è una sola e non appartiene a nessuna vista.
// =====================================================
import * as watch from '@/lib/watch';
import { mergeSetDone } from '@/lib/session-merge';
import { db } from '@/lib/data/client';
import {
  createSessionFromSnapshot, getSession, updateSession,
} from '@/lib/data/sessions';

/**
 * Traduce la chiave che il Watch usa per una sessione nell'id della riga.
 *
 * La chiave ha due origini: per una sessione nata al polso è il
 * `client_session_id` generato lì; per una sessione nata sull'iPhone e poi
 * adottata dal Watch è l'**id della riga**, perché quando l'iPhone l'ha aperta
 * nessun `client_session_id` esisteva. Senza questa risoluzione le serie
 * chiuse al polso su una sessione adottata verrebbero scartate in silenzio.
 */
async function resolveSessionId(key, memberId, cache) {
  if (cache[key] !== undefined) return cache[key];

  const { data } = await db()
    .from('workout_sessions')
    .select('id')
    .eq('member_id', memberId)
    .or(`id.eq.${key},client_session_id.eq.${key}`)
    .limit(1)
    .maybeSingle();

  cache[key] = data?.id ?? null;
  return cache[key];
}

/**
 * Svuota il buffer nativo e applica tutto in ordine.
 *
 * ⚠️ `watch.getState()` SVUOTA il buffer: se questa funzione fallisce a metà,
 * i messaggi già estratti sono persi. Per questo la sessione viene creata al
 * primo evento utile e ogni `set_done` viene persistito subito, invece di
 * accumulare e salvare alla fine.
 *
 * @returns {{ sessionId: string|null }} la sessione toccata, se ce n'è una.
 */
export async function drainWatchMessages(memberId) {
  if (!watch.isSupported()) return { sessionId: null };

  const state = await watch.getState();
  const pending = state.pending || [];
  if (!pending.length) return { sessionId: null };

  const cache = {};   // chiave del Watch -> id Supabase (null = introvabile)
  let touched = null;

  for (const msg of pending) {
    try {
      if (msg.type === 'session_started') {
        const session = await createSessionFromSnapshot({
          client_session_id: msg.client_session_id,
          workout_id: msg.workout_id,
          workout_title: msg.workout_title,
          day_index: msg.day_index,
          day_name: msg.day_name,
          started_at: msg.started_at,
          exercises_log: msg.exercises_log,
        }, memberId);
        cache[msg.client_session_id] = session.id;
        touched = session.id;
      } else if (msg.type === 'set_done') {
        const id = await resolveSessionId(msg.client_session_id, memberId, cache);
        if (!id) continue;
        const session = await getSession(id);
        const { log, changed } = mergeSetDone(session.exercises_log, {
          uid: msg.uid, reps: msg.reps, load: msg.load,
          ...(msg.incline !== undefined ? { incline: msg.incline } : {}),
          done_at: msg.done_at,
        });
        if (changed) await updateSession(id, { exercises_log: log });
        touched = id;
      } else if (msg.type === 'session_closed') {
        const id = await resolveSessionId(msg.client_session_id, memberId, cache);
        if (!id) continue;
        await updateSession(id, { completed_at: msg.completed_at });
        touched = id;
      }
    } catch {
      // Un messaggio che non si riesce ad applicare non deve bloccare gli
      // altri: perdere una serie è meglio che perdere l'allenamento.
    }
  }

  return { sessionId: touched };
}
```

- [ ] **Step 3: Svuotare il buffer all'apertura dell'app**

In `frontend/src/views/member/TrainingView.vue`, aggiungere l'import:

```js
import { drainWatchMessages } from '@/lib/watch-session';
```

e, **all'inizio di `load()`** (prima del `Promise.all` alle righe 290-293), l'importazione di quanto arrivato dal Watch:

```js
async function load() {
  loading.value = true;
  try {
    // Il Watch può aver svolto un allenamento intero con questa app chiusa:
    // qui è dove quei dati entrano nel database. Va PRIMA della lettura, o la
    // lista mostrerebbe lo stato precedente all'importazione.
    try {
      await drainWatchMessages(user.value.id);
    } catch { /* il Watch è opzionale: non deve impedire di allenarsi */ }

    [schede.value, sessions.value] = await Promise.all([
```

- [ ] **Step 4: Inviare il "fatto" dell'iPhone al Watch**

In `frontend/src/views/member/SessionView.vue`, aggiungere accanto agli altri `computed`:

```js
// Chiave con cui il Watch identifica questa sessione. Una sessione nata
// sull'iPhone non ha `client_session_id` — non esisteva nessun Watch quando
// è stata creata — e allora si usa l'id della riga. Deve essere la STESSA
// stringa qui e in setSessionState, o il Watch e l'iPhone parlerebbero di due
// sessioni diverse.
const watchSessionKey = computed(() =>
  session.value?.client_session_id || session.value?.id || '');
```

Poi, dentro `onSetButton`, nel ramo `if (!row.done)`, dopo `persist()`:

```js
    // Il Watch deve sapere che questa serie è chiusa, o mostrerebbe ancora
    // il tasto Fatto per una serie già fatta. `queued: true` (default): se il
    // Watch è al polso ma l'app non è aperta, il messaggio lo aspetta.
    watch.send({
      type: 'set_done',
      client_session_id: watchSessionKey.value,
      uid: row.uid,
      reps: row.reps,
      load: row.load,
      ...(row.incline !== undefined ? { incline: row.incline } : {}),
      done_at: row.done_at,
    }).catch(() => {});
```

- [ ] **Step 5: Applicare i `set_done` in arrivo mentre la sessione è aperta**

Nel listener `watch.onMessage` aggiunto al Task 8, estendere lo smistamento:

```js
    watchUnsub = watch.onMessage(async (msg) => {
      if (msg?.type === 'biometrics') {
        watchLive.value = true;
        if (msg.hr != null) liveHR.value = msg.hr;
        if (msg.kcal != null) liveKcal.value = msg.kcal;
        lastSampleAt.value = Date.now();
        return;
      }
      if (msg?.type === 'set_done') {
        const { log, changed } = mergeSetDone(session.value.exercises_log, {
          uid: msg.uid, reps: msg.reps, load: msg.load,
          ...(msg.incline !== undefined ? { incline: msg.incline } : {}),
          done_at: msg.done_at,
        });
        // `changed` false significa che questo fatto era già noto: persistere
        // e ritrasmettere farebbe rimbalzare lo stesso evento fra i due
        // dispositivi senza fine.
        if (!changed) return;
        session.value.exercises_log = log;
        await persist();
      }
    });
```

E aggiungere l'import in cima:

```js
import { mergeSetDone } from '@/lib/session-merge';
```

- [ ] **Step 6: Verificare la sincronizzazione nei due versi**

Ricostruire, sincronizzare, installare. Avviare una sessione **dal Watch**, chiudere due serie al polso con l'iPhone bloccato in tasca. Poi aprire l'app iPhone e andare su Allenamento.

Atteso: la sessione compare nell'elenco come in corso; aprendola, le due serie risultano fatte con i valori giusti e `started_at` è l'ora in cui hai iniziato al polso, non quella di apertura dell'app.

Poi, con entrambe le app aperte, premere Fatto **sull'iPhone**. Atteso: entro pochi secondi il conteggio serie sul Watch avanza.

Premere Fatto **sul Watch**. Atteso: la riga corrispondente sull'iPhone diventa fatta.

- [ ] **Step 7: Verificare l'idempotenza**

Chiudere la stessa serie sull'iPhone e poi sul Watch a distanza di qualche secondo.

Atteso: nessun doppione, i valori sono quelli del primo dei due, e le due app non entrano in un ciclo di messaggi (osservabile in console: il traffico si ferma).

- [ ] **Step 8: Commit**

```bash
cd /Users/gomutako/Developer/gym
git add frontend/src/lib/watch-session.js frontend/src/views/member frontend/ios/App
git commit -m "feat(watch): fatto sincronizzato nei due versi e import su Supabase

Il buffer nativo viene svuotato all'apertura della lista allenamenti: il
Watch può aver svolto una sessione intera con l'app iPhone chiusa.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Aggancio a metà sessione

**Files:**
- Modify: `frontend/ios/App/App/WatchLinkPlugin.swift`
- Modify: `frontend/ios/App/PalladeWatch Watch App/PhoneLink.swift`
- Modify: `frontend/ios/App/PalladeWatch Watch App/ContentView.swift`
- Modify: `frontend/ios/App/PalladeWatch Watch App/PickerView.swift`
- Modify: `frontend/src/views/member/SessionView.vue`

**Interfaces:**
- Consumes: tutto il precedente.
- Produces: messaggio `state_request` con risposta sincrona `{ session: {...} | null }`; il plugin iOS mantiene su disco `watchlink-state.json`.

- [ ] **Step 1: Far mantenere al plugin iOS lo stato corrente**

A `state_request` deve rispondere il **plugin nativo dalla propria copia persistita**, non il JavaScript: la richiesta arriva tipicamente a schermo spento, quando la WebView è sospesa e non può rispondere entro il tempo utile.

In `WatchLinkPlugin.swift`, aggiungere:

```swift
    private let stateURL: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory,
                                           in: .userDomainMask)[0]
        return dir.appendingPathComponent("watchlink-state.json")
    }()

    /// Copia dello stato della sessione iPhone, mantenuta aggiornata dal JS.
    /// Serve solo a rispondere a `state_request` quando la WebView dorme.
    @objc func setSessionState(_ call: CAPPluginCall) {
        guard let payload = call.getObject("payload") else {
            try? FileManager.default.removeItem(at: stateURL)
            call.resolve()
            return
        }
        if let data = try? JSONSerialization.data(withJSONObject: payload) {
            try? data.write(to: stateURL, options: .atomic)
        }
        call.resolve()
    }

    private func currentSessionState() -> [String: Any]? {
        guard let data = try? Data(contentsOf: stateURL) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }
```

E il gestore delle richieste con risposta:

```swift
    public func session(_ session: WCSession, didReceiveMessage message: [String: Any],
                        replyHandler: @escaping ([String: Any]) -> Void) {
        guard (message["type"] as? String) == "state_request" else {
            deliver(message)
            replyHandler([:])
            return
        }
        replyHandler(["session": currentSessionState() as Any])
    }
```

Aggiungere `CAP_PLUGIN_METHOD(setSessionState, CAPPluginReturnPromise);` a `WatchLinkPlugin.m`, e in `frontend/src/lib/watch.js`:

```js
// Copia nativa dello stato, per rispondere al Watch mentre la WebView dorme.
// Passare null la cancella (sessione chiusa).
export async function setSessionState(payload) {
  if (!native) return;
  await WatchLink.setSessionState(payload ? { payload } : {});
}
```

- [ ] **Step 2: Tenerla aggiornata da `SessionView`**

In `SessionView.vue`, dentro `persist()` (righe 217-226), dopo l'`updateSession` riuscita:

```js
    // Copia nativa per l'aggancio del Watch: la richiesta arriva quando la
    // WebView è sospesa e non potrebbe rispondere.
    watch.setSessionState({
      client_session_id: watchSessionKey.value,
      workout_id: session.value.workout_id,
      workout_title: session.value.workout_title,
      day_index: session.value.day_index,
      day_name: session.value.day_name,
      started_at: session.value.started_at,
      exercises_log: session.value.exercises_log,
    }).catch(() => {});
```

E in `complete()` (righe 320-326), dopo `updateSession`:

```js
    watch.setSessionState(null).catch(() => {});
```

- [ ] **Step 3: Chiedere lo stato dal Watch**

In `PhoneLink.swift`:

```swift
    /// Chiede all'iPhone la sessione in corso. Risponde il plugin nativo
    /// dalla sua copia su disco, quindi funziona anche a WebView sospesa.
    func requestState(completion: @escaping ([String: Any]?) -> Void) {
        let session = WCSession.default
        guard session.activationState == .activated, session.isReachable else {
            completion(nil); return
        }
        session.sendMessage(["type": "state_request"]) { reply in
            DispatchQueue.main.async { completion(reply["session"] as? [String: Any]) }
        } errorHandler: { _ in
            DispatchQueue.main.async { completion(nil) }
        }
    }
```

- [ ] **Step 4: Importare la sessione nel `SessionStore`**

In `SessionStore.swift`:

```swift
    /// Adotta una sessione già aperta sull'iPhone. Le serie senza `uid` non
    /// sono correlabili: la sessione viene rifiutata invece di agganciarsi a
    /// indici che cambierebbero sotto i piedi.
    func adopt(_ payload: [String: Any], nameFor: (String) -> String) -> Bool {
        guard let cid = payload["client_session_id"] as? String,
              let log = payload["exercises_log"] as? [[String: Any]],
              !log.isEmpty else { return false }

        var exercises: [LiveExercise] = []
        for ex in log {
            guard let exId = ex["exercise_id"] as? String,
                  let rows = ex["sets_log"] as? [[String: Any]] else { return false }
            var sets: [LiveSet] = []
            for r in rows {
                guard let uid = r["uid"] as? String else { return false }
                sets.append(LiveSet(
                    uid: uid, reps: r["reps"] as? Int, load: r["load"] as? Double,
                    incline: r["incline"] as? Double,
                    done: r["done"] as? Bool ?? false,
                    doneAt: (r["done_at"] as? String)
                        .flatMap { ISO8601DateFormatter.withFraction.date(from: $0) }))
            }
            exercises.append(LiveExercise(
                exerciseId: exId, name: nameFor(exId),
                restSeconds: ex["rest_seconds"] as? Int ?? 0,
                loadType: ex["load_type"] as? String ?? "weight", sets: sets))
        }

        session = LiveSession(
            clientSessionId: cid,
            workoutId: payload["workout_id"] as? String ?? "",
            workoutTitle: payload["workout_title"] as? String ?? "Allenamento",
            dayIndex: payload["day_index"] as? Int ?? 0,
            dayName: payload["day_name"] as? String ?? "",
            startedAt: (payload["started_at"] as? String)
                .flatMap { ISO8601DateFormatter.withFraction.date(from: $0) } ?? Date(),
            exercises: exercises)
        persist()
        return true
    }
```

- [ ] **Step 5: Offrire l'aggancio nel picker**

`PickerView` non deve possedere lo stato dell'aggancio: lo riceve e segnala l'intenzione, come già fa con `onPick`. Modificare la firma e aggiungere la sezione in cima alla `List`:

```swift
struct PickerView: View {
    @StateObject private var catalog = CatalogStore.shared
    var onPick: (CachedWorkout, CachedDay) -> Void
    /// Sessione già aperta sull'iPhone, se ce n'è una da riprendere.
    var adoption: [String: Any]?
    var onAdopt: () -> Void
```

Dentro il ramo `List`, come primo elemento:

```swift
                if let adoption, let title = adoption["day_name"] as? String {
                    Section {
                        Button("Riprendi \(title)") { onAdopt() }
                        Text("Frequenza cardiaca e calorie partono da adesso.")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }
```

La seconda riga è necessaria, non decorativa: prima dell'aggancio non esisteva un workout attivo, quindi i biometrici non coprono l'inizio della sessione e l'utente deve saperlo.

In `ContentView.swift`, aggiungere lo stato accanto a `error`:

```swift
    @State private var pendingAdoption: [String: Any]?
```

Passare i due nuovi parametri alla `PickerView` esistente:

```swift
                PickerView(onPick: { w, d in
                    Task {
                        guard await workout.requestAuth() else {
                            error = "Senza accesso a Salute non posso registrare l'allenamento."
                            return
                        }
                        _ = await RestNotifier.requestPermission()
                        let live = store.begin(workout: w, day: d)
                        PhoneLink.shared.send(sessionStartedPayload(live), queued: true)
                        do { try await workout.start() }
                        catch {
                            store.close()
                            self.error = error.localizedDescription
                        }
                    }
                }, adoption: pendingAdoption, onAdopt: {
                    guard let pending = pendingAdoption else { return }
                    let names = Dictionary(
                        CatalogStore.shared.workouts
                            .flatMap { $0.days }.flatMap { $0.exercises }
                            .map { ($0.exerciseId, $0.name) },
                        uniquingKeysWith: { first, _ in first })
                    guard SessionStore.shared.adopt(pending, nameFor: { names[$0] ?? "Esercizio" })
                    else {
                        error = "Questo allenamento è stato creato con una versione precedente e non si può riprendere dal Watch."
                        pendingAdoption = nil
                        return
                    }
                    Task {
                        guard await WorkoutController.shared.requestAuth() else {
                            error = "Senza accesso a Salute non posso registrare l'allenamento."
                            SessionStore.shared.close()
                            return
                        }
                        _ = await RestNotifier.requestPermission()
                        do { try await WorkoutController.shared.start() }
                        catch {
                            SessionStore.shared.close()
                            self.error = error.localizedDescription
                        }
                        pendingAdoption = nil
                    }
                })
```

`uniquingKeysWith` e non `uniqueKeysWithValues`: lo stesso esercizio compare in più giornate e più schede, e il costruttore che pretende chiavi uniche **va in crash a runtime** sui duplicati.

E dentro `.onAppear`, dopo `PhoneLink.shared.activate()`:

```swift
            PhoneLink.shared.requestState { payload in
                guard let payload, SessionStore.shared.session == nil else { return }
                pendingAdoption = payload
            }
```

- [ ] **Step 6: Verificare l'aggancio sul device**

Avviare una sessione **dall'iPhone**, chiudere una serie, poi aprire l'app sul Watch.

Atteso: in cima al picker compare "Riprendi <nome giornata>" con la nota sui biometrici. Toccandolo parte la sessione al polso con la serie già fatta contata, e da lì il bpm compare sull'iPhone come "Watch".

- [ ] **Step 7: Verificare il rifiuto delle sessioni vecchie**

Creare a mano una sessione priva di `uid` (dalla dashboard Supabase locale, modificando `exercises_log` per togliere gli `uid`), aprirla sull'iPhone, poi aprire il Watch.

Atteso: il messaggio *"…creato con una versione precedente e non si può riprendere dal Watch"*, e il picker resta usabile per avviare una sessione nuova.

- [ ] **Step 8: Commit**

```bash
cd /Users/gomutako/Developer/gym
git add frontend/ios/App frontend/src/lib/watch.js frontend/src/views/member/SessionView.vue
git commit -m "feat(watch): aggancio a metà sessione

Risponde il plugin nativo dalla copia su disco: la richiesta arriva a
schermo spento, quando la WebView non potrebbe rispondere in tempo.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Verifica finale del vincolo di opzionalità e documentazione

Il vincolo che regge il progetto — *il Watch è opzionale* — non è verificato da nessun task precedente, perché ognuno guardava il caso con il Watch. Questo task guarda il caso senza.

**Files:**
- Modify: `CLAUDE.md` (sezione "App iOS (Capacitor)")
- Modify: `docs/superpowers/specs/2026-08-02-watch-companion-design.md` (se le prove hanno smentito qualcosa)

- [ ] **Step 1: Verificare il web**

```bash
cd /Users/gomutako/Developer/gym && npm run dev:fe
```

Aprire `http://localhost:5173` in un browser, entrare come member, svolgere un allenamento completo: avvio, tre serie chiuse con recupero, completamento.

Atteso: nessun errore in console, nessuna menzione del Watch nell'interfaccia, comportamento identico a prima del progetto. Se in console compare un errore da `watch.js`, il wrapper non sta degradando: correggerlo prima di procedere.

- [ ] **Step 2: Verificare l'iPhone senza Watch**

Scollegare/spegnere l'Apple Watch (o toglierlo dal polso e attivare la modalità aereo sull'orologio). Sull'iPhone svolgere un allenamento completo.

Atteso: tutto funziona; i badge biometrici si comportano come prima del progetto (valori da HealthKit o assenti); nessun errore, nessun blocco in attesa del Watch.

- [ ] **Step 3: Verificare l'iPhone con Watch accoppiato ma app non installata**

Disinstallare la watch app dall'orologio, tenendolo accoppiato. Svolgere un allenamento dall'iPhone.

Atteso: `pushCatalog` esce con `{ pushed: false, reason: 'app non installata sul Watch' }` senza sollevare, e l'allenamento procede.

- [ ] **Step 4: Documentare in `CLAUDE.md`**

Aggiungere alla sezione "App iOS (Capacitor)", dopo il paragrafo sulla notifica di fine recupero:

```markdown
### App companion Apple Watch

Target `PalladeWatch Watch App` nello stesso progetto Xcode, bundle id
`it.pallade.app.watchkitapp` (il prefisso è imposto da watchOS), deployment
target watchOS 10. È **opzionale**: ogni funzione esiste anche senza, e il web
non cambia comportamento.

- ⚠️ **Su Apple Watch esiste UNA sola sessione di allenamento attiva alla
  volta.** La nostra app *sostituisce* l'app Allenamento durante la palestra e
  salva l'`HKWorkout` a fine sessione, così gli anelli restano corretti. Con un
  allenamento già attivo altrove `startActivity` può non tornare mai: di qui il
  timeout in `WorkoutController.start()`.
- **Aprire la `HKWorkoutSession` è l'unico modo di girare in background** su
  watchOS. Senza, l'app si sospende appena si abbassa il polso.
- **L'app Fitness non espone serie né ripetizioni**: non c'è nulla da
  importare, i dati degli esercizi viaggiano iPhone → Watch.
- **Trasporto: WatchConnectivity, non il mirroring HealthKit.** Il risveglio
  che il mirroring offre sveglia il processo nativo, non la WebView, che resta
  sospesa comunque: pagheremmo un'API con difetti noti per un beneficio che non
  possiamo incassare.
- ⚠️ **Il buffer sta nel plugin nativo**, non nel JS: quando il Watch invia, la
  WebView è quasi sempre sospesa. `watch.getState()` **svuota** il buffer —
  chi la chiama deve consumare `pending`.
- ⚠️ **Le serie si referenziano per `uid`, mai per posizione**: `addSet` e
  `removeSet` sull'iPhone spostano gli indici. Le sessioni create prima del
  2026-08-02 non hanno `uid` e il Watch le rifiuta.
- **La fusione è duplicata** in `frontend/src/lib/session-merge.js` e in
  `SessionStore.swift`: modificarne una senza l'altra fa divergere i
  dispositivi in silenzio.
- **Il recupero non è uno stato sincronizzato**: è la scadenza derivata
  `done_at + rest_seconds`, che i due dispositivi calcolano identica.
```

- [ ] **Step 5: Aggiornare lo spec se le prove l'hanno smentito**

Rileggere `docs/superpowers/specs/2026-08-02-watch-companion-design.md` alla luce di ciò che è emerso sul device — in particolare la sezione "Rischi aperti", dove l'esito del Task 1 (provisioning) e del Task 1 Step 6 (`cap sync`) va sostituito con il fatto accertato.

- [ ] **Step 6: Commit**

```bash
cd /Users/gomutako/Developer/gym
git add CLAUDE.md docs/superpowers/specs/2026-08-02-watch-companion-design.md
git commit -m "docs(watch): documenta i vincoli watchOS e l'opzionalità

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Prima del rilascio

- **Applicare la migration al cloud PRIMA di rilasciare il codice**: `npm run db:push:dry` per l'anteprima, poi `npm run db:push` o il workflow GitHub *DB migrate*. Nell'ordine sbagliato il sintomo è silenzioso — un client vecchio non conosce `client_session_id` e il dato non si salva senza che nessuno segnali un errore.
- **Alzare `MARKETING_VERSION` e `CURRENT_PROJECT_VERSION`** in `project.pbxproj` (a mano: `npm version` non tocca il progetto Xcode). Con un target watchOS le due versioni devono coincidere fra app iPhone e app Watch, o l'upload viene rifiutato.
- **Ricostruire il bundle prima dell'archive**: saltarlo non dà errore, si archivia la SPA vecchia già presente in `ios/App/App/public`.
