# Notifica di fine recupero fra le serie — Design

Data: 2026-07-28
Stato: approvato

## Obiettivo

Avvisare chi si allena che il recupero fra due serie è finito, **anche quando il telefono
è in tasca o bloccato**, e riportarlo con un tocco all'esercizio giusto della sessione in
corso.

Oggi il conto alla rovescia esiste solo a schermo: chi appoggia il telefono e guarda
altrove non ha modo di sapere quando ripartire, se non riprendendolo in mano e
riaccendendolo. In palestra è il caso normale, non l'eccezione.

## Decisioni prese (brainstorming)

- **Solo app iOS.** Notifiche locali native. Sul web il timer a schermo resta com'è:
  nessuno si allena davanti a un browser, e un secondo percorso di codice non si
  ripagherebbe.
- **Una sola notifica alla volta, l'ultima vince.** Ogni nuovo "fatto" annulla la
  precedente. Rispecchia come ci si allena — un recupero alla volta — ed evita che il
  telefono suoni per una serie già superata.
- **Permesso chiesto al primo "fatto" con recupero**, cioè quando il motivo è evidente e
  la richiesta ha la massima probabilità di essere accettata.
- **Se il permesso è negato**: resta il timer a schermo, non lo si richiede mai più e
  **non si mostra alcun messaggio** che inviti ad aprire le impostazioni.
- **Time Sensitive.** Deve passare anche con una Full Immersion attiva: chi si allena con
  la musica ne ha quasi sempre una. Richiede l'entitlement
  `com.apple.developer.usernotifications.time-sensitive`, che l'account a pagamento
  consente, e una riga di motivazione in review ("timer di recupero fra le serie", che è
  il caso d'uso previsto dalla categoria).
- **Uscire dalla sessione non annulla la notifica**: l'allenamento resta aperto e il
  recupero sta comunque scorrendo.

## Approccio scelto

**Notifica locale programmata e sostituita.** Al "fatto" si programma una notifica con
l'istante di scadenza; la si annulla o rimpiazza quando lo stato cambia. Nessuna rete,
nessun processo in background: la consegna è compito di iOS e avviene anche ad app chiusa.

Scartate:

- **Timer nativo in background** — iOS non concede a un'app come questa timer lunghi in
  background: più codice per un avviso meno affidabile.
- **Push dal server via APNs** — certificati, un job schedulato su Supabase e la rete
  accesa in palestra, per un conto alla rovescia che il dispositivo sa fare da solo.

## Architettura

### `frontend/src/lib/rest-notifications.js` (nuovo)

Unico punto di contatto col plugin, sullo stesso schema di `lib/healthkit.js` e
`lib/native-tabbar.js`: sul web ogni funzione è un no-op, così `SessionView` non deve
sapere su cosa sta girando.

| Funzione | Compito |
| --- | --- |
| `isSupported()` | vero solo nell'app iOS |
| `ensurePermission()` | chiede il permesso una volta sola; ritorna se è concesso |
| `schedule({ at, exerciseName, setNumber, setCount, sessionId, exerciseIndex })` | annulla la pendente e ne programma una |
| `cancel()` | annulla la notifica pendente |
| `onTap(handler)` | registra il gestore del tocco |

Sotto non c'è un plugin di terze parti ma **codice nostro**: vedi la nota qui sotto.
Entitlement nuovo in `App.entitlements`.

### `frontend/ios/App/App/RestTimerPlugin.swift` (nuovo)

⚠️ **Perché non `@capacitor/local-notifications`.** Verificato scaricando il pacchetto: la
versione 6 — l'unica compatibile con il Capacitor 6 del progetto — **non espone
`interruptionLevel`**, né nelle definizioni TypeScript né nel codice Swift. Il supporto
esiste dalla 7/8, che richiederebbe di migrare Capacitor: troppo rischio per una feature
sola. Senza `interruptionLevel` la notifica non è Time Sensitive e una Full Immersion la
silenzia, cioè fallisce proprio nel caso che motiva la scelta.

Si scrive quindi un `CAPPlugin` che parla direttamente con `UNUserNotificationCenter`,
sullo stesso modello di `NativeTabBarPlugin` e `HealthKitLivePlugin` già presenti.
Espone `requestPermission`, `schedule`, `cancel`, e notifica il tocco al lato JS.
Nessuna dipendenza JavaScript nuova.

### Identità della notifica

Id **costante** (`1`): per decisione di progetto ne esiste al massimo una, e riprogrammare
con lo stesso id sostituisce quella pendente. Nei dati della notifica viaggiano
`sessionId` ed `exerciseIndex`, che servono al ritorno.

### Contenuto

- Titolo: **Recupero terminato**
- Corpo: nome dell'esercizio e serie che viene ora — es. *«Panca piana · serie 3 di 4»*

## Flusso

1. **"Fatto" su una serie** con `rest_seconds > 0` → `ensurePermission()`; se concesso,
   `schedule()` con `at = adesso + rest_seconds`.
2. **Recupero chiuso in anticipo** (secondo tocco sul pulsante) o **serie annullata** →
   `cancel()`.
3. **Allenamento terminato** → `cancel()`.
4. **Uscita dalla sessione senza terminarla** → nessuna cancellazione (decisione presa).
5. **Tocco sulla notifica** → evento `localNotificationActionPerformed` → navigazione a
   `allenamento/sessione/<sessionId>?ex=<exerciseIndex>`. `SessionView` legge `ex` dalla
   query e posiziona il carosello su quell'esercizio. Vale sia ad app viva sia ad avvio a
   freddo, come già avviene per gli universal link in `lib/deep-links.js`.

## Correzione necessaria: il timer a schermo deve stare sull'orologio

Il conto alla rovescia attuale (`SessionView`, `startRest`) è un `setInterval` che scala di
uno al secondo. Quando iOS sospende la WebView quel contatore **si ferma**: al ritorno
mostra un valore indietro rispetto al tempo reale.

Finché il timer era l'unica fonte il difetto passava inosservato; con la notifica
diventerebbe una contraddizione visibile — l'avviso è già arrivato e lo schermo dice che
mancano quaranta secondi.

Si conserva quindi **l'istante di fine** per ogni riga e il rimanente si calcola da quello
a ogni tick e alla riapertura. La notifica e la schermata leggono così lo stesso orologio.

## Casi limite

| Caso | Comportamento |
| --- | --- |
| `rest_seconds` a zero o assente | nessuna notifica, come oggi nessun timer |
| Permesso negato | timer a schermo, nessuna richiesta ulteriore, nessun messaggio |
| App in primo piano allo scadere | la notifica arriva comunque: il telefono può essere in tasca con l'app aperta |
| Sessione già completata quando si tocca la notifica | si apre lo stesso la sessione, che mostra il proprio stato reale |
| Sessione cancellata nel frattempo | la vista gestisce già l'id inesistente con il proprio errore |
| Più "fatto" ravvicinati | vince l'ultimo, i precedenti vengono sostituiti |

## Verifiche

Non esistono test unitari nel progetto: si verifica sul device fisico, che qui è
indispensabile perché il comportamento da provare è quello di iOS.

1. Telefono **bloccato**: la notifica arriva allo scadere e il tocco apre l'esercizio giusto.
2. App **chiusa** (rimossa dal multitasking): la notifica arriva comunque; l'avvio a freddo
   naviga all'esercizio corretto.
3. **Full Immersion attiva**: la notifica passa (verifica dell'entitlement Time Sensitive).
4. **Recupero chiuso in anticipo**: nessuna notifica in arrivo.
5. **Ritorno dopo un lungo background**: il numero a schermo coincide col tempo davvero
   trascorso.
6. **Permesso negato**: l'app continua a funzionare senza avvisi né messaggi.

## Fuori scope

- Notifiche sul web e nella PWA.
- Un interruttore per disattivarle dal profilo: chi non le vuole nega il permesso.
- Suoni personalizzati, azioni rapide dalla notifica ("+30 secondi"), notifiche di
  incoraggiamento o di riepilogo a fine allenamento.
