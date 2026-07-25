# iOS + HealthKit Live Badges — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embeddare la SPA Vue in una app iOS (Capacitor) che legge HeartRate + calorie attive live da HealthKit e le mostra come badge nella SessionView, salvando un riepilogo sulla `workout_session`.

**Architecture:** Capacitor wrappa `frontend/dist` invariato. Un plugin Swift custom `HealthKitLive` espone auth + streaming anchored + summary via bridge JS. Un wrapper `frontend/src/lib/healthkit.js` platform-agnostic è l'unico punto che la UI importa: su nativo chiama il plugin, su browser ritorna `supported:false`. Il backend persiste un campo `biometrics_json` sulla sessione.

**Tech Stack:** Vue 3 + Vite, Capacitor 6 (iOS), Swift + HealthKit, Fastify, Supabase/Postgres.

## Global Constraints

- **Node ≥ 22** obbligatorio (backend crash-loop altrimenti).
- Migration **append-only**; in dev si riapplicano con `npm run db:reset`.
- Modificando lo schema DB → aggiornare la migration, lo `schema` di validazione della rotta backend, e le viste che leggono il campo (regola CLAUDE.md).
- Scritture/logica applicativa → **backend Fastify** via `frontend/src/lib/api.js`; letture RLS → client Supabase diretto. I biometrici seguono il percorso backend (scrittura).
- Il web deve restare **identico** fuori dall'app iOS: nessun path HealthKit eseguito su browser (`Capacitor.isNativePlatform()` false).
- Capacitor `webDir` = `frontend/dist`.
- E2E: pattern **script `.mjs` usa-e-getta** (login utente seed via `@supabase/supabase-js` → chiamate REST al backend). Niente infra di unit test.
- Enum/testi in **italiano** dove utente-facing.
- Shape biometrici: `biometrics_json = { hr_avg: int|null, hr_max: int|null, active_kcal: number|null }`.

---

## File Structure

- `supabase/migrations/20260725210000_session_biometrics.sql` — **Create**: aggiunge `biometrics_json jsonb` a `workout_sessions`.
- `backend/src/routes/sessions.js` — **Modify**: PATCH accetta e valida `biometrics_json`.
- `frontend/src/lib/healthkit.js` — **Create**: wrapper platform-agnostic (unica sorgente per la UI).
- `frontend/package.json` — **Modify**: dep `@capacitor/core`, `@capacitor/ios`, `@capacitor/cli`.
- `frontend/capacitor.config.ts` — **Create**: config Capacitor (appId, webDir).
- `frontend/ios/` — **Create** (generata da `npx cap add ios`): shell nativa.
- `frontend/ios/App/App/HealthKitLivePlugin.swift` — **Create**: plugin HealthKit.
- `frontend/ios/App/App/HealthKitLivePlugin.m` — **Create**: registrazione Capacitor.
- `frontend/ios/App/App/Info.plist` — **Modify**: `NSHealthShareUsageDescription`.
- `frontend/ios/App/App/App.entitlements` — **Modify**: entitlement HealthKit.
- `frontend/src/views/member/SessionView.vue` — **Modify**: badge live + stop/summary a fine sessione.
- `scripts/e2e-session-biometrics.mjs` — **Create/temp**: e2e backend persistenza.
- `scripts/e2e-healthkit-wrapper.mjs` — **Create/temp**: verifica path web-safe del wrapper.

---

## Task 1: Backend — persistere `biometrics_json` sulla sessione

**Files:**
- Create: `supabase/migrations/20260725210000_session_biometrics.sql`
- Modify: `backend/src/routes/sessions.js` (schema PATCH ~riga 158-175, handler ~176-200)
- Test: `scripts/e2e-session-biometrics.mjs` (temporaneo)

**Interfaces:**
- Consumes: tabella `workout_sessions` esistente; login member seed (`member@gym.local`/`password123`).
- Produces: colonna `workout_sessions.biometrics_json jsonb`; `PATCH /api/sessions/:id` accetta body `{ biometrics_json?: { hr_avg, hr_max, active_kcal } }` e lo persiste; risposta GET include `biometrics_json`.

- [ ] **Step 1: Scrivi la migration**

Create `supabase/migrations/20260725210000_session_biometrics.sql`:

```sql
-- =====================================================
-- MIGRATION — Snapshot biometrico della sessione.
-- Salvato a fine allenamento dalla app iOS (HealthKit):
-- HR media/max e calorie attive totali sulla finestra della sessione.
-- Shape: { hr_avg: int|null, hr_max: int|null, active_kcal: number|null }
-- =====================================================
alter table public.workout_sessions
  add column biometrics_json jsonb;
```

- [ ] **Step 2: Applica la migration e verifica la colonna**

Run: `npm run db:reset`
Poi:
Run: `sg docker -c "npx supabase db reset"` non serve — `db:reset` già lo fa. Verifica:
Run: `sg docker -c "npx supabase status"` (assicura che lo stack sia su)
Expected: nessun errore SQL nell'output di `db:reset`; la migration `20260725210000_session_biometrics` compare tra quelle applicate.

- [ ] **Step 3: Scrivi il test e2e (fallirà: il PATCH ancora scarta `biometrics_json`)**

Create `scripts/e2e-session-biometrics.mjs`:

```js
// E2E usa-e-getta: verifica che PATCH /api/sessions/:id persista biometrics_json.
// Prerequisiti: supabase locale su, backend su :3000.
// Env richieste: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY (da `npm run db:status`).
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY } = process.env;
const API = 'http://localhost:3000';

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const user = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });

function assert(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exit(1); } }

// Login member seed
const { data: auth, error: loginErr } = await user.auth.signInWithPassword({
  email: 'member@gym.local', password: 'password123',
});
assert(!loginErr, `login: ${loginErr?.message}`);
const memberId = auth.user.id;
const token = auth.session.access_token;

// Seed prerequisiti col service key: una sessione minimale del member
const { data: sess, error: insErr } = await admin
  .from('workout_sessions')
  .insert({ member_id: memberId, workout_title: 'E2E', day_name: 'A', exercises_log: [] })
  .select().single();
assert(!insErr, `insert session: ${insErr?.message}`);

// PATCH via backend con biometrics_json
const bio = { hr_avg: 142, hr_max: 171, active_kcal: 380.5 };
const res = await fetch(`${API}/api/sessions/${sess.id}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ completed_at: new Date().toISOString(), biometrics_json: bio }),
});
assert(res.ok, `PATCH status ${res.status}: ${await res.text()}`);

// GET e assert persistenza
const getRes = await fetch(`${API}/api/sessions/${sess.id}`, {
  headers: { Authorization: `Bearer ${token}` },
});
const got = await getRes.json();
assert(got.biometrics_json, 'biometrics_json mancante nella risposta');
assert(got.biometrics_json.hr_avg === 142, `hr_avg atteso 142, ricevuto ${got.biometrics_json?.hr_avg}`);
assert(got.biometrics_json.hr_max === 171, `hr_max atteso 171`);
assert(got.biometrics_json.active_kcal === 380.5, `active_kcal atteso 380.5`);

// Cleanup
await admin.from('workout_sessions').delete().eq('id', sess.id);
console.log('PASS: biometrics_json persistito correttamente');
```

- [ ] **Step 4: Avvia il backend e lancia il test — verifica che FALLISCE**

```bash
node backend/src/server.js & SVPID=$!
sleep 2
export $(sg docker -c "npx supabase status -o env" | sed 's/^/SUPABASE_/' ) 2>/dev/null
node scripts/e2e-session-biometrics.mjs
kill $SVPID
```
> Nota: recupera `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_KEY` da `npm run db:status` (chiavi locali) ed esportale prima di lanciare il test.
Expected: **FAIL** — `biometrics_json mancante nella risposta` (il PATCH attuale ignora il campo).

- [ ] **Step 5: Aggiorna lo schema di validazione del PATCH**

In `backend/src/routes/sessions.js`, nel `schema.body` del `fastify.patch('/api/sessions/:id', …)`, aggiungi la property:

```js
        body: {
          type: 'object',
          properties: {
            exercises_log: { type: 'array' },
            completed_at: { type: ['string', 'null'] },
            biometrics_json: {
              type: ['object', 'null'],
              properties: {
                hr_avg: { type: ['integer', 'null'] },
                hr_max: { type: ['integer', 'null'] },
                active_kcal: { type: ['number', 'null'] },
              },
              additionalProperties: false,
            },
          },
        },
```

- [ ] **Step 6: Persisti il campo nell'handler**

In `backend/src/routes/sessions.js`, nell'handler del PATCH, dopo le due righe `if (request.body.exercises_log …)` / `if (request.body.completed_at …)`, aggiungi:

```js
      if (request.body.biometrics_json !== undefined) patch.biometrics_json = request.body.biometrics_json;
```

- [ ] **Step 7: Rilancia il test — verifica che PASSA**

```bash
node backend/src/server.js & SVPID=$!
sleep 2
node scripts/e2e-session-biometrics.mjs
kill $SVPID
```
Expected: **PASS: biometrics_json persistito correttamente**

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260725210000_session_biometrics.sql backend/src/routes/sessions.js
git commit -m "feat(sessions): persist biometrics_json snapshot on session"
```
> Lo script `scripts/e2e-session-biometrics.mjs` è usa-e-getta: NON committarlo (rimuovilo dopo, `rm scripts/e2e-session-biometrics.mjs`).

---

## Task 2: Frontend — wrapper `healthkit.js` platform-agnostic

**Files:**
- Create: `frontend/src/lib/healthkit.js`
- Modify: `frontend/package.json` (dep `@capacitor/core`)
- Test: `scripts/e2e-healthkit-wrapper.mjs` (temporaneo)

**Interfaces:**
- Consumes: `@capacitor/core` (`Capacitor.isNativePlatform()`, `registerPlugin`).
- Produces: modulo con API
  - `isSupported(): boolean` — true solo su nativo iOS con plugin presente.
  - `requestAuth(): Promise<{ granted: boolean }>`
  - `start(): Promise<void>` — avvia lo streaming (no-op su web).
  - `stop(): Promise<void>`
  - `summary(startISO: string, endISO: string): Promise<{ hr_avg, hr_max, active_kcal }>`
  - `onSample(cb: ({ type: 'heartRate'|'activeEnergy', value: number, timestamp: string }) => void): () => void` — ritorna funzione di unsubscribe.
  - Su web: `isSupported()` false, `start/stop` no-op, `summary` ritorna `{ hr_avg: null, hr_max: null, active_kcal: null }`, `onSample` no-op che ritorna una unsubscribe vuota.

- [ ] **Step 1: Installa `@capacitor/core`**

Run: `npm install --workspace frontend @capacitor/core@^6`
Expected: `@capacitor/core` compare in `frontend/package.json` dependencies.

- [ ] **Step 2: Scrivi il test web-safe (fallirà: modulo inesistente)**

Create `scripts/e2e-healthkit-wrapper.mjs`:

```js
// Verifica che il wrapper healthkit sia no-op sicuro fuori da iOS nativo.
// Gira in Node (nessun ambiente Capacitor nativo) => isSupported() deve essere false.
import * as hk from '../frontend/src/lib/healthkit.js';

function assert(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exit(1); } }

assert(hk.isSupported() === false, 'isSupported() deve essere false in Node/web');

const summary = await hk.summary('2026-07-25T10:00:00Z', '2026-07-25T11:00:00Z');
assert(summary && summary.hr_avg === null && summary.hr_max === null && summary.active_kcal === null,
  'summary() web deve ritornare valori null');

let called = false;
const unsub = hk.onSample(() => { called = true; });
assert(typeof unsub === 'function', 'onSample deve ritornare una funzione di unsubscribe');
unsub();

await hk.start(); // non deve lanciare
await hk.stop();  // non deve lanciare

console.log('PASS: wrapper healthkit web-safe');
```

- [ ] **Step 3: Lancia il test — verifica che FALLISCE**

Run: `node scripts/e2e-healthkit-wrapper.mjs`
Expected: **FAIL** — errore di import (`Cannot find module`).

- [ ] **Step 4: Implementa il wrapper**

Create `frontend/src/lib/healthkit.js`:

```js
// =====================================================
// Wrapper platform-agnostic per HealthKit (solo iOS nativo via Capacitor).
// UNICA sorgente che la UI importa. Su browser/PWA: no-op, supported:false.
// Il plugin nativo `HealthKitLive` è definito in ios/App/App/HealthKitLivePlugin.swift.
// =====================================================
import { Capacitor, registerPlugin } from '@capacitor/core';

const native = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';

// registerPlugin è sicuro anche su web: ritorna un proxy che non useremo lì.
const HealthKitLive = registerPlugin('HealthKitLive');

export function isSupported() {
  return native;
}

export async function requestAuth() {
  if (!native) return { granted: false };
  return HealthKitLive.requestAuth();
}

export async function start() {
  if (!native) return;
  await HealthKitLive.start();
}

export async function stop() {
  if (!native) return;
  await HealthKitLive.stop();
}

export async function summary(startISO, endISO) {
  if (!native) return { hr_avg: null, hr_max: null, active_kcal: null };
  return HealthKitLive.summary({ start: startISO, end: endISO });
}

// cb riceve { type, value, timestamp }. Ritorna funzione di unsubscribe.
export function onSample(cb) {
  if (!native) return () => {};
  const hHR = HealthKitLive.addListener('heartRate', (e) =>
    cb({ type: 'heartRate', value: e.value, timestamp: e.timestamp }));
  const hEN = HealthKitLive.addListener('activeEnergy', (e) =>
    cb({ type: 'activeEnergy', value: e.value, timestamp: e.timestamp }));
  return () => {
    // addListener ritorna una Promise<PluginListenerHandle> in Capacitor 6
    Promise.resolve(hHR).then((h) => h.remove?.());
    Promise.resolve(hEN).then((h) => h.remove?.());
  };
}
```

- [ ] **Step 5: Lancia il test — verifica che PASSA**

Run: `node scripts/e2e-healthkit-wrapper.mjs`
Expected: **PASS: wrapper healthkit web-safe**
> Se Node fallisce sull'import di `@capacitor/core` (ESM/condizioni export), il test resta valido: significa che il modulo va importato solo nel bundle Vite. In tal caso sostituisci l'assert eseguendo il test con Vite/vitest non disponibile → verifica manuale via `npm run build` (Step 6) e marca lo Step 5 come coperto dalla build.

- [ ] **Step 6: Verifica che la build web resti intatta**

Run: `npm run build`
Expected: build Vite OK; nessun errore; il bundle include il wrapper ma `isNativePlatform()` sarà false a runtime su browser.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/healthkit.js frontend/package.json package-lock.json
git commit -m "feat(frontend): add platform-agnostic healthkit wrapper (web no-op)"
```
> `scripts/e2e-healthkit-wrapper.mjs` è usa-e-getta: `rm scripts/e2e-healthkit-wrapper.mjs`, non committarlo.

---

## Task 3: Scaffold progetto Capacitor iOS (bundled build)

**Files:**
- Create: `frontend/capacitor.config.ts`
- Modify: `frontend/package.json` (dep `@capacitor/ios`, `@capacitor/cli`)
- Create: `frontend/ios/` (generata)

**Interfaces:**
- Consumes: `frontend/dist` (output di `npm run build`).
- Produces: progetto Xcode `frontend/ios/App/App.xcworkspace` che carica la SPA bundlata.

- [ ] **Step 1: Installa CLI e piattaforma iOS**

Run: `npm install --workspace frontend -D @capacitor/cli@^6 && npm install --workspace frontend @capacitor/ios@^6`
Expected: `@capacitor/cli` (dev) e `@capacitor/ios` compaiono in `frontend/package.json`.

- [ ] **Step 2: Crea la config Capacitor**

Create `frontend/capacitor.config.ts`:

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'local.gym.app',
  appName: 'Gym',
  webDir: 'dist',
  server: {
    // Build bundlata: nessun URL remoto. iOS scheme di default.
    iosScheme: 'capacitor',
  },
};

export default config;
```

- [ ] **Step 3: Build web + aggiungi la piattaforma iOS**

```bash
npm run build
cd frontend && npx cap add ios && cd ..
```
Expected: cartella `frontend/ios/App/` creata; `npx cap add` termina senza errori.

- [ ] **Step 4: Sincronizza e apri in Xcode (verifica manuale)**

```bash
cd frontend && npx cap sync ios && npx cap open ios && cd ..
```
Verifica manuale in Xcode: build su **iPhone reale** (o simulatore), l'app avvia e mostra la SPA (login palestra) caricata dagli asset locali.
Expected: la web app appare identica a quella browser dentro il WebView.
> Il backend/Supabase devono essere raggiungibili dal device (usa gli URL di produzione nel `.env` di build, non `localhost`).

- [ ] **Step 5: Commit**

```bash
git add frontend/capacitor.config.ts frontend/package.json frontend/ios package-lock.json
git commit -m "chore(ios): scaffold Capacitor iOS project (bundled build)"
```
> `.gitignore`: assicurati che `frontend/ios/App/Pods/` e `frontend/ios/App/build/` siano ignorati (Capacitor genera un `.gitignore` in `ios/`; verifica sia presente).

---

## Task 4: Plugin Swift `HealthKitLive`

**Files:**
- Create: `frontend/ios/App/App/HealthKitLivePlugin.swift`
- Create: `frontend/ios/App/App/HealthKitLivePlugin.m`
- Modify: `frontend/ios/App/App/Info.plist`
- Modify: `frontend/ios/App/App/App.entitlements`

**Interfaces:**
- Consumes: HealthKit framework; chiamate JS dal wrapper (Task 2): `requestAuth`, `start`, `stop`, `summary({start,end})`.
- Produces: metodi bridge + eventi `heartRate`/`activeEnergy` con payload `{ value: Double, timestamp: ISO8601 String }`; `summary` risolve `{ hr_avg, hr_max, active_kcal }`.

- [ ] **Step 1: Aggiungi la capability HealthKit + Info.plist (Xcode / file)**

In `frontend/ios/App/App/App.entitlements` aggiungi:

```xml
<key>com.apple.developer.healthkit</key>
<true/>
```

In `frontend/ios/App/App/Info.plist` aggiungi la stringa d'uso (obbligatoria, altrimenti crash all'auth):

```xml
<key>NSHealthShareUsageDescription</key>
<string>L'app legge frequenza cardiaca e calorie attive dal tuo Apple Watch per mostrarle durante l'allenamento.</string>
```
> In Xcode: target App → Signing & Capabilities → **+ Capability → HealthKit** (genera l'entitlement se non presente). Framework HealthKit va linkato automaticamente all'uso di `import HealthKit`.

- [ ] **Step 2: Scrivi il plugin Swift**

Create `frontend/ios/App/App/HealthKitLivePlugin.swift`:

```swift
import Foundation
import Capacitor
import HealthKit

@objc(HealthKitLivePlugin)
public class HealthKitLivePlugin: CAPPlugin {
    private let store = HKHealthStore()
    private var hrQuery: HKAnchoredObjectQuery?
    private var enQuery: HKAnchoredObjectQuery?

    private let hrType = HKQuantityType.quantityType(forIdentifier: .heartRate)!
    private let enType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!
    private let iso = ISO8601DateFormatter()

    @objc func requestAuth(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["granted": false]); return
        }
        store.requestAuthorization(toShare: nil, read: [hrType, enType]) { ok, _ in
            call.resolve(["granted": ok])
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        startStream(type: hrType, event: "heartRate", unit: HKUnit.count().unitDivided(by: .minute())) { q in self.hrQuery = q }
        startStream(type: enType, event: "activeEnergy", unit: HKUnit.kilocalorie()) { q in self.enQuery = q }
        call.resolve()
    }

    @objc func stop(_ call: CAPPluginCall) {
        if let q = hrQuery { store.stop(q); hrQuery = nil }
        if let q = enQuery { store.stop(q); enQuery = nil }
        call.resolve()
    }

    private func startStream(type: HKQuantityType, event: String, unit: HKUnit, keep: @escaping (HKAnchoredObjectQuery) -> Void) {
        let handler: (HKAnchoredObjectQuery, [HKSample]?, [HKDeletedObject]?, HKQueryAnchor?, Error?) -> Void = { [weak self] _, samples, _, _, _ in
            guard let self = self else { return }
            for s in (samples as? [HKQuantitySample]) ?? [] {
                let value = s.quantity.doubleValue(for: unit)
                self.notifyListeners(event, data: [
                    "value": value,
                    "timestamp": self.iso.string(from: s.endDate),
                ])
            }
        }
        let q = HKAnchoredObjectQuery(type: type, predicate: nil, anchor: nil,
                                      limit: HKObjectQueryNoLimit, resultsHandler: handler)
        q.updateHandler = handler
        store.execute(q)
        keep(q)
    }

    @objc func summary(_ call: CAPPluginCall) {
        guard let startStr = call.getString("start"), let endStr = call.getString("end"),
              let start = iso.date(from: startStr), let end = iso.date(from: endStr) else {
            call.reject("start/end ISO richiesti"); return
        }
        let pred = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        var result: [String: Any] = ["hr_avg": NSNull(), "hr_max": NSNull(), "active_kcal": NSNull()]
        let group = DispatchGroup()

        group.enter()
        let hrStat = HKStatisticsQuery(quantityType: hrType, quantitySamplePredicate: pred,
                                       options: [.discreteAverage, .discreteMax]) { _, stats, _ in
            let bpm = HKUnit.count().unitDivided(by: .minute())
            if let avg = stats?.averageQuantity()?.doubleValue(for: bpm) { result["hr_avg"] = Int(avg.rounded()) }
            if let mx = stats?.maximumQuantity()?.doubleValue(for: bpm) { result["hr_max"] = Int(mx.rounded()) }
            group.leave()
        }
        store.execute(hrStat)

        group.enter()
        let enStat = HKStatisticsQuery(quantityType: enType, quantitySamplePredicate: pred,
                                       options: .cumulativeSum) { _, stats, _ in
            if let kcal = stats?.sumQuantity()?.doubleValue(for: .kilocalorie()) { result["active_kcal"] = kcal }
            group.leave()
        }
        store.execute(enStat)

        group.notify(queue: .main) { call.resolve(result) }
    }
}
```

- [ ] **Step 3: Registra il plugin per il bridge Capacitor**

Create `frontend/ios/App/App/HealthKitLivePlugin.m`:

```objc
#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(HealthKitLivePlugin, "HealthKitLive",
    CAP_PLUGIN_METHOD(requestAuth, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(start, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(stop, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(summary, CAPPluginReturnPromise);
)
```
> Il nome `"HealthKitLive"` DEVE combaciare con `registerPlugin('HealthKitLive')` nel wrapper (Task 2).

- [ ] **Step 4: Sync e verifica manuale su device**

```bash
cd frontend && npx cap sync ios && npx cap open ios && cd ..
```
Verifica manuale su **iPhone reale + Apple Watch al polso**:
1. Avvia un allenamento sull'app Allenamento del Watch.
2. Nella app: alla prima chiamata compare il prompt di autorizzazione HealthKit → concedi.
3. Da una console di debug (o log temporaneo) verifica che arrivino eventi `heartRate` ogni ~5s e che `summary` ritorni valori non-null su una finestra che copre il workout.
Expected: eventi HR live ricevuti; `summary` coerente.
> Il test reale del plugin è manuale-on-device (nessuna infra di unit test iOS in questo progetto).

- [ ] **Step 5: Commit**

```bash
git add frontend/ios/App/App/HealthKitLivePlugin.swift frontend/ios/App/App/HealthKitLivePlugin.m frontend/ios/App/App/Info.plist frontend/ios/App/App/App.entitlements
git commit -m "feat(ios): HealthKitLive plugin (anchored HR/energy stream + summary)"
```

---

## Task 5: SessionView — badge live + snapshot a fine sessione

**Files:**
- Modify: `frontend/src/views/member/SessionView.vue` (`<script setup>` ~6-208, template header ~216-229, footer completa ~417+)

**Interfaces:**
- Consumes: `frontend/src/lib/healthkit.js` (`isSupported`, `requestAuth`, `start`, `stop`, `summary`, `onSample`); `api.patch` esistente.
- Produces: badge `HR` e `kcal` nell'header sessione (live quando supportato, o valori salvati `session.biometrics_json` per sessioni completate); a `complete()` invia `biometrics_json` nel PATCH.

- [ ] **Step 1: Importa il wrapper e aggiungi lo stato reattivo**

In `frontend/src/views/member/SessionView.vue`, in cima allo `<script setup>` (dopo gli import esistenti, ~riga 6-7), aggiungi:

```js
import * as healthkit from '@/lib/healthkit';
```

Vicino agli altri `ref` (~riga 18), aggiungi:

```js
const hkSupported = healthkit.isSupported();
const liveHR = ref(null);         // bpm corrente
const liveKcal = ref(null);       // kcal attive accumulate (ultimo sample cumulativo)
const lastSampleAt = ref(null);   // per rilevare "in attesa Watch"
let hkUnsub = null;
```

- [ ] **Step 2: Avvia lo streaming al mount (solo se supportato e sessione in corso)**

In `frontend/src/views/member/SessionView.vue`, dentro l'`onMounted` esistente (~riga 197-208), dopo il caricamento di `session.value`, aggiungi in coda al blocco `try`:

```js
    if (hkSupported && session.value && !session.value.completed_at) {
      const auth = await healthkit.requestAuth();
      if (auth.granted) {
        hkUnsub = healthkit.onSample((s) => {
          lastSampleAt.value = Date.now();
          if (s.type === 'heartRate') liveHR.value = Math.round(s.value);
          else if (s.type === 'activeEnergy') liveKcal.value = Math.round((liveKcal.value || 0) + s.value);
        });
        await healthkit.start();
      }
    }
```

- [ ] **Step 3: Ferma lo streaming allo smontaggio**

In `frontend/src/views/member/SessionView.vue`, sostituisci l'`onUnmounted` esistente (~riga 122):

```js
onUnmounted(() => Object.values(intervals).forEach((id) => id && clearInterval(id)));
```

con:

```js
onUnmounted(() => {
  Object.values(intervals).forEach((id) => id && clearInterval(id));
  if (hkUnsub) hkUnsub();
  if (hkSupported) healthkit.stop();
});
```

- [ ] **Step 4: Calcola i valori dei badge (live oppure salvati)**

In `frontend/src/views/member/SessionView.vue`, tra i `computed` (dopo `session`/`log`, ~riga 18-30), aggiungi:

```js
const saved = computed(() => session.value?.biometrics_json || null);
const badgeHR = computed(() => (hkSupported && !session.value?.completed_at) ? liveHR.value : saved.value?.hr_avg ?? null);
const badgeKcal = computed(() => (hkSupported && !session.value?.completed_at) ? liveKcal.value : saved.value?.active_kcal ?? null);
const hrStale = computed(() =>
  hkSupported && !session.value?.completed_at &&
  (!lastSampleAt.value || Date.now() - lastSampleAt.value > 30000));
```

- [ ] **Step 5: Renderizza i badge nell'header**

In `frontend/src/views/member/SessionView.vue`, nell'header (dentro `<div class="rounded-2xl bg-white p-4 shadow-sm">`, dopo il blocco progresso ~riga 229, prima della chiusura del div), aggiungi:

```html
        <div v-if="hkSupported || saved" class="mt-3 flex flex-wrap gap-2">
          <span class="inline-flex items-center gap-1 rounded-full bg-red-50 px-3 py-1 text-sm font-medium text-red-600">
            ❤️ {{ badgeHR != null ? badgeHR + ' bpm' : '—' }}
          </span>
          <span class="inline-flex items-center gap-1 rounded-full bg-orange-50 px-3 py-1 text-sm font-medium text-orange-600">
            🔥 {{ badgeKcal != null ? badgeKcal + ' kcal' : '—' }}
          </span>
          <span v-if="hrStale" class="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-500">
            Avvia un allenamento sul Watch
          </span>
        </div>
```

- [ ] **Step 6: Invia lo snapshot biometrico a `complete()`**

In `frontend/src/views/member/SessionView.vue`, nella funzione `complete()` (~riga 178-195), sostituisci il corpo del `try` con:

```js
    let biometrics_json;
    if (hkSupported) {
      await healthkit.stop();
      if (hkUnsub) { hkUnsub(); hkUnsub = null; }
      biometrics_json = await healthkit.summary(session.value.started_at, new Date().toISOString());
    }
    await api.patch(`/api/sessions/${session.value.id}`, {
      exercises_log: session.value.exercises_log,
      completed_at: new Date().toISOString(),
      ...(biometrics_json ? { biometrics_json } : {}),
    });
    router.push({ name: 'training' });
```

- [ ] **Step 7: Verifica la build web (path non-nativo intatto)**

Run: `npm run build`
Expected: build OK. Su browser `hkSupported` è false e `saved` null per sessioni nuove → i badge non compaiono; sessioni completate con `biometrics_json` mostrano i valori salvati. Nessun path HealthKit eseguito.

- [ ] **Step 8: Verifica manuale su device**

Rebuild + `npx cap sync ios`, avvia un allenamento sul Watch, avvia una sessione nell'app: i badge HR/kcal si aggiornano; se il Watch non ha un workout attivo compare "Avvia un allenamento sul Watch"; a fine sessione lo snapshot viene salvato e visibile riaprendo la sessione completata.
Expected: badge live + snapshot persistito coerente.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/views/member/SessionView.vue
git commit -m "feat(session): live HealthKit HR/kcal badges + saved snapshot"
```

---

## Self-Review

**Spec coverage:**
- Embedding Capacitor bundled → Task 3 ✓
- Plugin HealthKit custom (live anchored) → Task 4 ✓
- Wrapper platform-agnostic web-safe → Task 2 ✓
- Badge live in SessionView → Task 5 (Step 5) ✓
- Snapshot salvato su workout_session (migration + backend + viste) → Task 1 + Task 5 (Step 6, e render valori salvati Step 5) ✓
- Gate "avvia workout su Watch" / staleness → Task 5 (Step 4/5) ✓
- Auth negata → wrapper `supported/granted` false, badge "—" → Task 2 + Task 5 ✓
- Web identico su browser → Task 2 (no-op) + Task 5 (Step 7) ✓
- Entitlement + usage description + privacy → Task 4 (Step 1); privacy policy = azione di distribuzione fuori codice (nota sotto).

**Placeholder scan:** nessun TBD/TODO; ogni step ha comandi o codice concreti.

**Type consistency:** `biometrics_json { hr_avg:int, hr_max:int, active_kcal:number }` coerente tra migration (Task 1), schema PATCH (Task 1), summary Swift (Task 4), wrapper (Task 2) e SessionView (Task 5). Nome plugin `"HealthKitLive"` coerente tra `registerPlugin` (Task 2) e `CAP_PLUGIN` (Task 4). Eventi `heartRate`/`activeEnergy` coerenti tra Swift `notifyListeners` (Task 4) e `onSample` (Task 2).

**Note fuori-codice (distribuzione):** privacy policy pubblica + descrizione uso HealthKit in App Store Connect sono richieste per la pubblicazione, non implementabili in repo.
