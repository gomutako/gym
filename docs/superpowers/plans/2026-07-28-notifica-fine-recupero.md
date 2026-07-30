# Notifica di fine recupero — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Avvisare con una notifica iOS che il recupero fra due serie è finito, anche a telefono bloccato, e riportare al tocco sull'esercizio giusto della sessione.

**Architecture:** Un `CAPPlugin` Swift scritto in casa (`RestTimerPlugin`) parla con `UNUserNotificationCenter`: chiede il permesso, programma **una sola** notifica Time Sensitive con id costante, la annulla, e riporta al lato JS il tocco. Un modulo `lib/rest-notifications.js` lo incapsula ed è un no-op sul web. `SessionView` programma al "fatto" e annulla quando il recupero finisce prima.

**Tech Stack:** Vue 3 `<script setup>`, Capacitor 6, Swift (UserNotifications), Xcode 26, Vite 8.

## Global Constraints

- **Solo iOS.** Sul web ogni funzione del modulo è un no-op: nessun percorso alternativo con le Web Notifications.
- **Una notifica alla volta**, id costante `1`: riprogrammare sostituisce la pendente.
- **Time Sensitive**: `content.interruptionLevel = .timeSensitive`, entitlement `com.apple.developer.usernotifications.time-sensitive`.
- **Permesso negato**: nessun secondo tentativo, nessun messaggio all'utente, nessun rimando alle impostazioni.
- **Niente `@capacitor/local-notifications`**: su Capacitor 6 non espone `interruptionLevel` (verificato nel pacchetto pubblicato).
- **Testo in italiano**, come tutta l'interfaccia.
- **Non esistono test unitari nel progetto** (vedi `CLAUDE.md`): le funzioni pure si verificano con uno script `node` usa-e-getta, il resto sul device fisico.
- ⚠️ **Non usare `pkill`/`ps | grep` sui processi di build**: il pattern matcha la shell stessa. Uccidere per PID.
- ⚠️ **`npx cap sync ios` va lanciato da `frontend/`**; `vite build` e `cap sync` non terminano da soli: verificare l'artefatto e chiudere per PID.

---

### Task 1: Modulo JS con le funzioni pure

**Files:**
- Create: `frontend/src/lib/rest-notifications.js`
- Test: `/tmp/check-rest-notifications.mjs` (usa-e-getta, non versionato)

**Interfaces:**
- Produces: `isSupported()`, `restBody(exerciseName, setNumber, setCount)`, `clampExerciseIndex(raw, count)`, `ensurePermission()`, `schedule(opts)`, `cancel()`, `onTap(handler)`

- [ ] **Step 1: Scrivere il modulo con le due funzioni pure e i gusci delle altre**

```js
// frontend/src/lib/rest-notifications.js
// =====================================================
// Notifica di fine recupero fra le serie (solo app iOS).
// Sul web ogni funzione è un no-op: è lo stesso schema di lib/healthkit.js e
// lib/native-tabbar.js, così le viste non devono sapere dove stanno girando.
//
// Sotto NON c'è @capacitor/local-notifications: la versione compatibile con
// Capacitor 6 non espone interruptionLevel, quindi la notifica non potrebbe
// essere Time Sensitive e una Full Immersion la silenzierebbe — cioè
// fallirebbe proprio nel caso che motiva la feature. Si passa da RestTimer,
// plugin Swift del progetto.
// =====================================================
import { Capacitor, registerPlugin } from '@capacitor/core';

const RestTimer = registerPlugin('RestTimer');

/** Vero solo nell'app iOS. */
export function isSupported() {
  return Capacitor.getPlatform() === 'ios';
}

/** Corpo della notifica: «Panca piana · serie 3 di 4». */
export function restBody(exerciseName, setNumber, setCount) {
  const nome = (exerciseName || 'Esercizio').trim();
  return `${nome} · serie ${setNumber} di ${setCount}`;
}

/**
 * Indice esercizio che arriva dalla query `?ex=`: viene da fuori, quindi va
 * ricondotto a un valore valido invece di fidarsene.
 */
export function clampExerciseIndex(raw, count) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || count <= 0) return 0;
  return Math.min(Math.max(n, 0), count - 1);
}

// --- Le tre funzioni che toccano il nativo (guscio, riempito nel Task 3) ---
export async function ensurePermission() { return false; }
export async function schedule() {}
export async function cancel() {}
export function onTap() {}
```

- [ ] **Step 2: Verificare le funzioni pure**

```bash
cat > /tmp/check-rest-notifications.mjs <<'EOF'
import { restBody, clampExerciseIndex } from '/Users/gomutako/Developer/gym/frontend/src/lib/rest-notifications.js';
const casi = [
  [restBody('Panca piana', 3, 4), 'Panca piana · serie 3 di 4'],
  [restBody('', 1, 3), 'Esercizio · serie 1 di 3'],
  [clampExerciseIndex('2', 5), 2],
  [clampExerciseIndex('99', 5), 4],
  [clampExerciseIndex('-1', 5), 0],
  [clampExerciseIndex('abc', 5), 0],
  [clampExerciseIndex('1', 0), 0],
];
let ko = 0;
for (const [avuto, atteso] of casi) {
  const ok = avuto === atteso;
  if (!ok) ko++;
  console.log(ok ? 'ok  ' : 'KO  ', JSON.stringify(avuto), '/ atteso', JSON.stringify(atteso));
}
process.exit(ko ? 1 : 0);
EOF
node /tmp/check-rest-notifications.mjs
```

Atteso: sette righe `ok`, uscita 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/gomutako/Developer/gym
rm -f /tmp/check-rest-notifications.mjs
git add frontend/src/lib/rest-notifications.js
git commit -m "feat(sessions): modulo per la notifica di fine recupero"
```

---

### Task 2: Il timer di recupero passa all'orologio

Correzione necessaria e indipendente: oggi `setInterval` scala di uno al secondo e **si ferma** quando iOS sospende la WebView, quindi al ritorno lo schermo mostra meno tempo trascorso di quello vero. Con la notifica diventerebbe una contraddizione visibile.

**Files:**
- Modify: `frontend/src/views/member/SessionView.vue` (funzioni `startRest`, `clearRest`, `endRest`, `restState`, blocco `onUnmounted`)

**Interfaces:**
- Produces: `restEndsAt` (reactive, chiave `"<exI>_<rowI>"` → epoch ms di fine), `restRemaining(exI, rowI)` → secondi mancanti, `restState(exI, rowI)` invariata nei valori (`null | 'resting' | 'over'`)

- [ ] **Step 1: Sostituire lo stato del timer**

Al posto di `const rest = reactive({})` e della mappa `intervals`:

```js
// --- Timer di recupero per riga ---
// Si conserva l'ISTANTE DI FINE, non i secondi rimanenti: in background iOS
// sospende la WebView e un contatore che scala da sé resterebbe indietro
// rispetto alla notifica già consegnata.
const restEndsAt = reactive({}); // key -> epoch ms di fine (0 = recupero chiuso)
const nowTick = ref(Date.now());
let tickInterval = null;
const keyOf = (exI, rowI) => `${exI}_${rowI}`;

function restRemaining(exI, rowI) {
  const end = restEndsAt[keyOf(exI, rowI)];
  if (end === undefined) return null;
  if (end === 0) return 0;
  return Math.max(0, Math.ceil((end - nowTick.value) / 1000));
}

function startRest(exI, rowI, seconds) {
  const k = keyOf(exI, rowI);
  if (!seconds || seconds <= 0) { restEndsAt[k] = 0; return; }
  restEndsAt[k] = Date.now() + seconds * 1000;
}

function clearRest(exI, rowI) {
  delete restEndsAt[keyOf(exI, rowI)];
}

// Chiude subito il recupero (equivale allo scadere): riga gialla
function endRest(exI, rowI) {
  restEndsAt[keyOf(exI, rowI)] = 0;
}

// Stato riga: 'resting' (in corso), 'over' (finito), null (mai avviato)
function restState(exI, rowI) {
  const v = restRemaining(exI, rowI);
  if (v === null) return null;
  return v > 0 ? 'resting' : 'over';
}
```

- [ ] **Step 2: Un solo tick per tutta la vista**

Aggiungere accanto agli altri `onMounted`/`onUnmounted` esistenti:

```js
onMounted(() => {
  // Un intervallo solo per la vista: aggiorna l'"adesso" da cui tutte le righe
  // ricavano il proprio rimanente.
  tickInterval = setInterval(() => { nowTick.value = Date.now(); }, 500);
  // Rientrando dal background il tick può essere stato sospeso: riallinea subito.
  document.addEventListener('visibilitychange', onVisible);
});

function onVisible() {
  if (!document.hidden) nowTick.value = Date.now();
}
```

E nel blocco `onUnmounted` già presente, al posto della riga che azzerava `intervals`:

```js
  if (tickInterval) clearInterval(tickInterval);
  document.removeEventListener('visibilitychange', onVisible);
```

- [ ] **Step 3: Aggiornare i punti del template che leggevano `rest`**

Cercare nel `<template>` gli usi del contatore e sostituirli con `restRemaining(...)`:

```bash
cd /Users/gomutako/Developer/gym
grep -n "rest\[" frontend/src/views/member/SessionView.vue
```

Ogni occorrenza `rest[keyOf(i, j)]` diventa `restRemaining(i, j)`. `fmtTimer()` resta invariata.

- [ ] **Step 4: Verificare che compili e che non resti nulla di vecchio**

```bash
cd /Users/gomutako/Developer/gym
grep -n "intervals\[\|const rest = reactive" frontend/src/views/member/SessionView.vue   # atteso: nessun risultato
npm run build > /tmp/b.log 2>&1 & sleep 25; grep -iE "built in|error" /tmp/b.log; kill %1 2>/dev/null
```

Atteso: `✓ built in …`, nessun errore, e il grep senza risultati.

- [ ] **Step 5: Commit**

```bash
cd /Users/gomutako/Developer/gym
git add frontend/src/views/member/SessionView.vue
git commit -m "fix(sessions): il timer di recupero legge l'orologio, non un contatore"
```

---

### Task 3: Plugin Swift `RestTimer`

**Files:**
- Create: `frontend/ios/App/App/RestTimerPlugin.swift`
- Modify: `frontend/ios/App/App/App.entitlements`
- Modify: `frontend/src/lib/rest-notifications.js` (riempie i quattro gusci)

**Interfaces:**
- Consumes: `restBody()` dal Task 1
- Produces (lato JS): `ensurePermission(): Promise<boolean>`, `schedule({ seconds, title, body, sessionId, exerciseIndex }): Promise<void>`, `cancel(): Promise<void>`, `onTap(handler)` dove `handler({ sessionId, exerciseIndex })`

- [ ] **Step 1: Entitlement Time Sensitive**

In `frontend/ios/App/App/App.entitlements`, dentro il `<dict>` esistente:

```xml
	<!-- Notifica di fine recupero: deve passare anche con una Full Immersion
	     attiva, che chi si allena con la musica ha quasi sempre. -->
	<key>com.apple.developer.usernotifications.time-sensitive</key>
	<true/>
```

Verifica: `plutil -lint frontend/ios/App/App/App.entitlements` → `OK`.

- [ ] **Step 2: Scrivere il plugin**

```swift
// frontend/ios/App/App/RestTimerPlugin.swift
// =====================================================
// Notifica locale di fine recupero fra le serie.
//
// Non si usa @capacitor/local-notifications: la versione compatibile con
// Capacitor 6 non espone `interruptionLevel`, quindi la notifica non sarebbe
// Time Sensitive e una Full Immersion la silenzierebbe.
//
// Ne esiste UNA sola alla volta (id costante): programmare di nuovo sostituisce
// quella pendente, che è esattamente il comportamento voluto quando si segna
// "fatto" su una seconda serie.
// =====================================================
import Foundation
import Capacitor
import UserNotifications

@objc(RestTimerPlugin)
public class RestTimerPlugin: CAPPlugin, UNUserNotificationCenterDelegate {
    /// Unica notifica gestita dal plugin.
    private static let identifier = "rest-timer"

    override public func load() {
        UNUserNotificationCenter.current().delegate = self
    }

    @objc func requestPermission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .sound]) { granted, _ in
                call.resolve(["granted": granted])
            }
    }

    @objc func schedule(_ call: CAPPluginCall) {
        let seconds = call.getDouble("seconds") ?? 0
        guard seconds > 0 else {
            call.reject("Durata del recupero non valida")
            return
        }

        let content = UNMutableNotificationContent()
        content.title = call.getString("title") ?? "Recupero terminato"
        content.body = call.getString("body") ?? ""
        content.sound = .default
        // La categoria che permette di superare la Full Immersion.
        content.interruptionLevel = .timeSensitive
        content.userInfo = [
            "sessionId": call.getString("sessionId") ?? "",
            "exerciseIndex": call.getInt("exerciseIndex") ?? 0,
        ]

        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: seconds, repeats: false)
        let request = UNNotificationRequest(
            identifier: Self.identifier, content: content, trigger: trigger)

        let center = UNUserNotificationCenter.current()
        // Rimuove esplicitamente la pendente: `add` con lo stesso id la
        // sostituisce, ma toglie di mezzo anche una eventuale già consegnata.
        center.removePendingNotificationRequests(withIdentifiers: [Self.identifier])
        center.removeDeliveredNotifications(withIdentifiers: [Self.identifier])
        center.add(request) { error in
            if let error = error { call.reject(error.localizedDescription) }
            else { call.resolve() }
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [Self.identifier])
        center.removeDeliveredNotifications(withIdentifiers: [Self.identifier])
        call.resolve()
    }

    /// Tocco sulla notifica: il lato JS naviga all'esercizio.
    public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let info = response.notification.request.content.userInfo
        notifyListeners("restTimerTapped", data: [
            "sessionId": info["sessionId"] as? String ?? "",
            "exerciseIndex": info["exerciseIndex"] as? Int ?? 0,
        ])
        completionHandler()
    }

    /// Con l'app in primo piano iOS non mostrerebbe nulla: il telefono può
    /// essere in tasca con l'app aperta, quindi l'avviso serve lo stesso.
    public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }
}
```

- [ ] **Step 3: Riempire i gusci nel modulo JS**

In `frontend/src/lib/rest-notifications.js`, al posto delle quattro funzioni vuote:

```js
// Il permesso si chiede una volta sola: se l'utente nega, iOS non ripropone il
// dialogo e per decisione di progetto non gli si mostra alcun messaggio.
let permission = null; // null = mai chiesto, true/false = esito

export async function ensurePermission() {
  if (!isSupported()) return false;
  if (permission !== null) return permission;
  try {
    const { granted } = await RestTimer.requestPermission();
    permission = !!granted;
  } catch {
    permission = false;
  }
  return permission;
}

/** Programma (sostituendola) l'unica notifica di fine recupero. */
export async function schedule({ seconds, body, sessionId, exerciseIndex }) {
  if (!isSupported()) return;
  await RestTimer.schedule({
    seconds,
    title: 'Recupero terminato',
    body,
    sessionId,
    exerciseIndex,
  });
}

export async function cancel() {
  if (!isSupported()) return;
  await RestTimer.cancel();
}

/** Tocco sulla notifica: handler({ sessionId, exerciseIndex }). */
export function onTap(handler) {
  if (!isSupported()) return;
  RestTimer.addListener('restTimerTapped', handler);
}
```

- [ ] **Step 4: Compilare per il device e verificare l'entitlement nel binario firmato**

```bash
cd /Users/gomutako/Developer/gym
npm run build > /tmp/b.log 2>&1 & sleep 25; grep -c "built in" /tmp/b.log; kill %1 2>/dev/null
cd frontend && npx cap sync ios > /tmp/s.log 2>&1 & sleep 20; grep -c "Sync finished" /tmp/s.log; kill %1 2>/dev/null
cd /Users/gomutako/Developer/gym
xcodebuild -workspace frontend/ios/App/App.xcworkspace -scheme App -configuration Debug \
  -destination 'id=0669878A-8208-5DFE-97B3-F5FADADDA6EC' \
  -derivedDataPath /tmp/DD -allowProvisioningUpdates build > /tmp/x.log 2>&1
grep -E "\*\* BUILD (SUCCEEDED|FAILED) \*\*" /tmp/x.log
codesign -d --entitlements - --xml /tmp/DD/Build/Products/Debug-iphoneos/App.app 2>/dev/null \
  | plutil -convert xml1 -o - - | grep -A1 time-sensitive
```

Atteso: `** BUILD SUCCEEDED **` e la chiave `com.apple.developer.usernotifications.time-sensitive` presente nel binario.

Se la firma fallisse perché l'entitlement non è nel profilo, aprire una volta il progetto in Xcode e aggiungere la capability *Time Sensitive Notifications* al target, poi ripetere.

- [ ] **Step 5: Commit**

```bash
cd /Users/gomutako/Developer/gym
git add frontend/ios/App/App/RestTimerPlugin.swift frontend/ios/App/App/App.entitlements frontend/src/lib/rest-notifications.js
git commit -m "feat(ios): plugin RestTimer per la notifica Time Sensitive di fine recupero"
```

---

### Task 4: `SessionView` programma e annulla

**Files:**
- Modify: `frontend/src/views/member/SessionView.vue`

**Interfaces:**
- Consumes: `ensurePermission()`, `schedule()`, `cancel()`, `restBody()` dal modulo del Task 1/3; `startRest`/`endRest` dal Task 2

- [ ] **Step 1: Importare il modulo**

```js
import * as restNotify from '@/lib/rest-notifications';
```

- [ ] **Step 2: Programmare al "fatto", annullare quando il recupero si chiude**

In `onSetButton`, nel ramo `if (!row.done)`, dopo `startRest(...)`:

```js
    // Notifica di fine recupero: il permesso si chiede qui, al primo "fatto"
    // con recupero, dove il motivo è evidente.
    const rest = log.value[exI].rest_seconds;
    if (rest > 0) {
      const ex = log.value[exI];
      restNotify.ensurePermission().then((ok) => {
        if (!ok) return;
        restNotify.schedule({
          seconds: rest,
          body: restNotify.restBody(
            catalogById.value[ex.exercise_id]?.name, rowI + 1, ex.sets_log.length),
          sessionId: session.value.id,
          exerciseIndex: exI,
        }).catch(() => { /* la notifica è un di più: non blocca l'allenamento */ });
      });
    }
```

Negli altri due rami dello stesso `onSetButton` — recupero chiuso in anticipo e serie annullata — aggiungere:

```js
    restNotify.cancel().catch(() => {});
```

`catalogById` è la `computed` già presente alla riga 38 della vista: è la stessa da cui il template ricava il titolo dell'esercizio, quindi il nome nella notifica coincide con quello a schermo.

⚠️ **Non annullare la notifica in `onUnmounted`.** Uscire dalla sessione senza terminarla la deve lasciare viva (decisione presa nel brainstorming): si sta comunque riposando e l'allenamento resta aperto.

- [ ] **Step 3: Annullare a fine allenamento**

In `complete()`, subito prima di `router.push({ name: 'training' })`:

```js
    restNotify.cancel().catch(() => {});
```

- [ ] **Step 4: Verificare che compili**

```bash
cd /Users/gomutako/Developer/gym
npm run build > /tmp/b.log 2>&1 & sleep 25; grep -iE "built in|error" /tmp/b.log; kill %1 2>/dev/null
```

Atteso: `✓ built in …`.

- [ ] **Step 5: Commit**

```bash
cd /Users/gomutako/Developer/gym
git add frontend/src/views/member/SessionView.vue
git commit -m "feat(sessions): programma la notifica al termine della serie"
```

---

### Task 5: Ritorno all'esercizio

**Files:**
- Modify: `frontend/src/main.js`
- Modify: `frontend/src/views/member/SessionView.vue`

**Interfaces:**
- Consumes: `onTap()` dal Task 3, `clampExerciseIndex()` dal Task 1

- [ ] **Step 1: Agganciare il tocco al router**

In `frontend/src/main.js`, accanto a `initDeepLinks(router)`:

```js
    // Tocco sulla notifica di fine recupero: riporta all'esercizio da cui è
    // partita. Stesso principio degli universal link, sorgente diversa.
    restNotify.onTap(({ sessionId, exerciseIndex }) => {
      if (!sessionId) return;
      router.push({
        name: 'session',
        params: { id: sessionId },
        query: { ex: String(exerciseIndex ?? 0) },
      });
    });
```

con l'import in cima:

```js
import * as restNotify from './lib/rest-notifications';
```

- [ ] **Step 2: Posizionare il carosello sull'esercizio della query**

In `SessionView.vue`, dentro l'`onMounted` esistente, **dopo** che `session.value` è stata caricata:

```js
    // ?ex=<indice>: arriva dal tocco sulla notifica di fine recupero.
    const ex = route.query.ex;
    if (ex !== undefined) {
      index.value = clampExerciseIndex(ex, log.value.length);
    }
```

con l'import:

```js
import { clampExerciseIndex } from '@/lib/rest-notifications';
```

Verificare che `route` sia già disponibile nella vista (`const route = useRoute()` è già presente).

- [ ] **Step 3: Gestire il tocco ad app già aperta sulla stessa sessione**

Se l'utente è già su quella sessione, `router.push` con gli stessi `params` non rimonta la vista e `onMounted` non riparte. Aggiungere in `SessionView.vue`:

```js
// La notifica può arrivare mentre si è già su questa sessione: lì il router non
// rimonta nulla, quindi il cambio di esercizio va seguito dalla query.
watch(() => route.query.ex, (ex) => {
  if (ex !== undefined && log.value.length) {
    index.value = clampExerciseIndex(ex, log.value.length);
  }
});
```

⚠️ `watch` **non** è fra gli import della vista: la riga 6 è
`import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';` e va estesa a
`import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue';`.

- [ ] **Step 4: Verificare che compili**

```bash
cd /Users/gomutako/Developer/gym
npm run build > /tmp/b.log 2>&1 & sleep 25; grep -iE "built in|error" /tmp/b.log; kill %1 2>/dev/null
```

Atteso: `✓ built in …`.

- [ ] **Step 5: Commit**

```bash
cd /Users/gomutako/Developer/gym
git add frontend/src/main.js frontend/src/views/member/SessionView.vue
git commit -m "feat(sessions): il tocco sulla notifica riapre l'esercizio giusto"
```

---

### Task 6: Verifica sul device e documentazione

**Files:**
- Modify: `CLAUDE.md` (sezione *App iOS (Capacitor)*)

- [ ] **Step 1: Installare sul telefono**

```bash
cd /Users/gomutako/Developer/gym
npm run build > /tmp/b.log 2>&1 & sleep 25; kill %1 2>/dev/null
cd frontend && npx cap sync ios > /tmp/s.log 2>&1 & sleep 20; kill %1 2>/dev/null
cd /Users/gomutako/Developer/gym
xcodebuild -workspace frontend/ios/App/App.xcworkspace -scheme App -configuration Debug \
  -destination 'id=0669878A-8208-5DFE-97B3-F5FADADDA6EC' \
  -derivedDataPath /tmp/DD -allowProvisioningUpdates build > /tmp/x.log 2>&1
grep -E "\*\* BUILD (SUCCEEDED|FAILED) \*\*" /tmp/x.log
xcrun devicectl device install app --device 0669878A-8208-5DFE-97B3-F5FADADDA6EC \
  /tmp/DD/Build/Products/Debug-iphoneos/App.app
```

- [ ] **Step 2: Percorrere la checklist sul telefono**

Usare un esercizio con recupero breve (30-60 s) per non aspettare.

1. Avvia un allenamento, tocca "fatto": compare la richiesta di permesso. **Concedi.**
2. **Blocca il telefono.** Allo scadere arriva la notifica; il tocco apre l'app sull'esercizio giusto.
3. **Chiudi l'app** dal multitasking, tocca "fatto" prima di chiuderla: la notifica arriva lo stesso e l'avvio a freddo porta all'esercizio.
4. **Attiva una Full Immersion** e ripeti: la notifica deve passare (prova dell'entitlement).
5. **Chiudi il recupero in anticipo** con il secondo tocco: nessuna notifica in arrivo.
6. **Rientra dopo un lungo background**: il numero a schermo coincide col tempo davvero trascorso (Task 2).
7. Segna "fatto" su due serie ravvicinate: arriva **una sola** notifica, quella dell'ultima.

- [ ] **Step 3: Annotare in `CLAUDE.md`**

Nella sezione *App iOS (Capacitor)*, fra i punti elenco:

```markdown
- **Notifica di fine recupero**: plugin Swift `RestTimerPlugin`, non
  `@capacitor/local-notifications` — la versione compatibile con Capacitor 6 non espone
  `interruptionLevel`, quindi la notifica non sarebbe Time Sensitive e una Full Immersion
  la silenzierebbe. Ne esiste una sola alla volta (id costante): riprogrammare sostituisce
  la pendente. Il permesso si chiede al primo "fatto" con recupero; se negato l'app tace e
  non lo richiede più.
```

- [ ] **Step 4: Commit**

```bash
cd /Users/gomutako/Developer/gym
git add CLAUDE.md
git commit -m "docs: notifica di fine recupero e perché il plugin è nostro"
```
