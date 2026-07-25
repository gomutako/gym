# Embed iOS + HealthKit live badges — Design

**Data:** 2026-07-25
**Stato:** approvato (brainstorming) → prossimo: writing-plans

## Obiettivo

Embeddare la web app palestra (Vue 3 SPA) in una vera app iOS per accedere ad
**HealthKit** e mostrare durante l'allenamento — come **badge** — la frequenza
cardiaca e le calorie attive, aggiornate in **live streaming**, salvando a fine
sessione un riepilogo (HR media/max, calorie attive totali) sulla `workout_session`.

## Decisioni prese (brainstorming)

| Tema | Decisione |
|------|-----------|
| Ambiente build | Completo: Mac + Xcode, Apple Developer account, iPhone reale |
| Flusso dati | **Live streaming** durante la SessionView |
| Sensore HR | Apple Watch **senza** app watchOS companion (letto dal telefono) |
| Embedding | **Capacitor** + plugin Swift HealthKit **custom** |
| Sorgente WebView | Build Vite **bundlata** (asset locali) |
| Persistenza | **Entrambi**: badge live a schermo + snapshot salvato su `workout_sessions` |

## Vincolo chiave: "Watch senza app companion"

Il live HR proviene dall'Apple Watch (l'iPhone non ha sensore HR). Senza una app
watchOS che apra una `HKWorkoutSession` di nostra proprietà:

- L'utente **deve avviare manualmente un allenamento sul Watch** (app Allenamento
  nativa o altra). Senza workout attivo, HealthKit campiona l'HR di rado (~5–10 min)
  → inutile per badge live.
- Con workout Watch attivo: i sample HR arrivano al telefono via
  `HKAnchoredObjectQuery` + background delivery ~ogni 5s, **latenza da pochi a
  decine di secondi**. Adatto a badge che si aggiornano ~ogni 10–15s, **non** a un
  ticker al secondo.
- Calorie attive (`activeEnergyBurned`): stesso meccanismo.

Upgrade futuro (fuori scope): aggiungere una app watchOS companion porta la latenza
sotto i 2–3s senza toccare il codice web.

## Architettura

Nuova cartella `ios/` (progetto **Capacitor**) che impacchetta `frontend/dist`.
Un **plugin Swift custom `HealthKitLive`** nel progetto iOS. Lato web, un wrapper
`frontend/src/lib/healthkit.js` che rileva la piattaforma:

- su **nativo** (Capacitor) → chiama il plugin;
- su **browser/PWA** → ritorna `supported:false` (no-op, app identica a oggi).

Un solo codebase; il web non cambia comportamento fuori dall'app iOS.

## Componenti (una responsabilità ciascuno)

- **`ios/`** — shell Capacitor sottile (generata da `npx cap add ios`).
- **`HealthKitLivePlugin.swift`** — auth HealthKit + streaming anchored + query
  summary.
  - Interfaccia: `requestAuth()`, `start()`, `stop()`, `summary(start, end)`.
  - Eventi emessi: `heartRate`, `activeEnergy` (payload: `{ value, timestamp }`).
- **`frontend/src/lib/healthkit.js`** — wrapper platform-agnostic, **unica**
  sorgente che la UI importa. Espone `isSupported()`, `start()`, `stop()`,
  `summary(start, end)`, e la sottoscrizione agli eventi.
- **`frontend/src/views/member/SessionView.vue`** — consuma il wrapper, rende i
  badge live, mostra il gate/hint "avvia workout su Watch".
- **`backend/src/routes/sessions.js`** — accetta lo snapshot biometrico al
  completamento della sessione.
- **migration** in `supabase/migrations/` — nuovo campo su `workout_sessions`.

## Flusso dati (live)

1. Utente avvia allenamento sul **Watch** (app nativa). SessionView mostra il
   gate/hint.
2. Avvio sessione → JS `healthkit.start()`.
3. Swift: `requestAuthorization` (`heartRate`, `activeEnergyBurned`) →
   `HKAnchoredObjectQuery` con `updateHandler` + background delivery → emette
   eventi `heartRate`/`activeEnergy` a ogni batch.
4. JS aggiorna stato reattivo → **badge** in SessionView.
5. Completamento → `healthkit.stop()` + `healthkit.summary(startedAt, completedAt)`
   via `HKStatisticsQuery` (HR media/max, calorie attive totali sulla finestra
   esatta della sessione) → invio al backend nella chiamata di completamento →
   **persistito**.

## Persistenza

- **Migration:** aggiungere `biometrics_json jsonb` a `workout_sessions`, forma
  `{ hr_avg, hr_max, active_kcal }`. Scelta coerente con lo stile del progetto
  (`days_json`, `exercises_log`) e future-proof per nuove metriche.
- **Backend:** aggiornare lo `schema` di validazione + la rotta `sessions` (rotta
  di completamento) per accettare e validare `biometrics_json`.
- **Frontend:** SessionView mostra i badge live; le viste storico/dettaglio
  sessione mostrano i badge salvati.

## Errori / edge case

- **Auth HealthKit negata** → wrapper `supported:false` → badge nascosti, la
  sessione funziona lo stesso.
- **Nessun workout Watch attivo** → HR rado → hint "Avvia allenamento sul Watch";
  se l'ultimo sample è più vecchio di ~30s → badge "in attesa Watch".
- **Browser/PWA** → path HealthKit mai eseguito, app come oggi.
- **Summary** usa i timestamp esatti start/end della sessione (finestra corretta
  anche in caso di sospensioni).

## Test

Nessuna infra di unit test (coerente col progetto).

- **Device (manuale):** iPhone + Watch reali → avvia workout Watch → verifica
  update badge live + snapshot salvato a fine sessione.
- **Wrapper web:** script e2e usa-e-getta con plugin **mockato** → SessionView
  rende i badge da eventi iniettati; verifica che il path `supported:false` resti
  intatto (app web invariata).
- **Backend:** estendere il pattern `.mjs` esistente → POST completamento sessione
  con `biometrics_json`, assert persistito.

## Distribuzione / build

- Build **bundlata**: `npm run build` → `npx cap sync`.
- Entitlement **HealthKit** + stringhe d'uso (`NSHealthShareUsageDescription`).
- App Store: richiede **privacy policy** e uso HealthKit chiaro.

## Fuori scope (per ora)

- App **watchOS companion** (upgrade futuro per latenza sub-3s; non tocca il web).
- Sensori BLE alternativi al Watch.
- Aggiornamento OTA del web via URL remoto (si è scelta la build bundlata).
