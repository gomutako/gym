# App companion Apple Watch — design

Data: 2026-08-02

Una app watchOS che affianca l'app iPhone durante l'allenamento in palestra: possiede la
sessione di allenamento HealthKit (quindi frequenza cardiaca in tempo reale e esecuzione in
background), mostra l'esercizio e la serie in corso, e gestisce il recupero con l'háptica al
polso.

## Vincoli tecnici verificati

Tre fatti hanno determinato la forma del progetto. Nessuno è aggirabile.

**Su Apple Watch esiste una sola sessione di allenamento attiva alla volta, di sistema.**
Non è una convivenza configurabile: se l'utente avvia l'app Allenamento mentre la nostra
sessione è in corso, la nostra viene terminata — vince l'ultima avviata. Nel verso opposto,
storicamente, `startActivity` non restituiva nemmeno un errore: restava appeso per sempre
([rdar://45703316](https://openradar.appspot.com/45703316)). Di conseguenza **la nostra app
sostituisce l'app Allenamento** durante la palestra; a fine sessione salva un `HKWorkout` di
tipo `traditionalStrengthTraining` in Salute, così anelli, calorie e cronologia Fitness
restano corretti come se avesse registrato Apple.

**Una watch app gira in background solo se possiede una `HKWorkoutSession`.** È l'unico
meccanismo che watchOS offre per l'esecuzione continua e l'accesso live ai sensori
(background mode *workout processing*). Senza sessione l'app viene sospesa appena non è in
primo piano. Il punto precedente e questo insieme rendono la scelta obbligata, non
preferenziale.

**L'app Allenamento di Apple non registra esercizi, serie, ripetizioni o carichi.** Per la
forza salva solo tipo, durata, calorie e frequenza cardiaca; in HealthKit non esiste un tipo
di dato per una serie o una ripetizione. Non c'è nulla da importare: i dati degli esercizi
sono già nostri (`workouts.days_json`, `workout_sessions.exercises_log`) e viaggiano
**iPhone → Watch**, non il contrario.

Un quarto vincolo viene dalla nostra architettura, non da Apple: **l'app iPhone è una WebView
Capacitor, sospesa in background.** Quando il Watch la risveglia, si sveglia il processo
nativo mentre il JavaScript resta addormentato. Ogni dato che arriva a schermo spento deve
essere bufferizzato da codice Swift e consegnato al web quando la WebView torna viva.

## Regola di design: il Watch è opzionale

> Nessuna funzionalità applicativa esiste solo al polso. Il Watch migliora la qualità dei
> dati e l'ergonomia; non aggiunge capacità. Ogni sessione deve poter nascere, svolgersi e
> chiudersi interamente su iPhone, esattamente come oggi.

L'unica cosa che l'iPhone da solo non può eguagliare è la **latenza** dei biometrici: non ha
il sensore, e senza un workout attivo sul Watch HealthKit campiona la frequenza cardiaca ogni
5–10 minuti. Il flusso iPhone-only resta quello odierno, completo ma degradato: badge
aggiornati a decine di secondi se l'utente ha avviato un allenamento dall'app Allenamento,
nessun badge se non l'ha fatto. Nessuna schermata si rompe, nessun dato manca.

Su browser e PWA il wrapper risponde `supported: false` e l'app resta identica a oggi.

## Decisioni

| Tema | Scelta |
| --- | --- |
| Proprietà della sessione di allenamento | La nostra watch app; l'app Allenamento non si usa |
| Avvio | Dal Watch (unico verso in cui iOS concede un risveglio automatico) o dall'iPhone |
| Aggancio a metà sessione | Sì, in entrambi i versi |
| Origine dei dati sul Watch | Cache spinta dall'iPhone; nessuna credenziale Supabase al polso |
| Scritture su Supabase | Solo dall'iPhone, quando la WebView è viva |
| Scope UI al polso | Esecuzione con valori pre-compilati; niente immissione di numeri |
| "Fatto" | Da entrambi i lati |
| Trasporto | Solo WatchConnectivity |

**Perché WatchConnectivity e non il mirroring HealthKit.** Il pregio principale di
`startMirroringToCompanionDevice()` è farsi risvegliare l'app iPhone da HealthKit — un
risveglio che a noi sveglia solo il processo nativo, con il JS sospeso: lo stesso risultato
che ottiene `sendMessage`, che risveglia comunque l'app iOS in background. Pagheremmo la
complessità di un'API con difetti documentati (`sendToRemoteWorkoutSession` fallisce con
*"Remote session delegate is not set up"*, a volte con oltre mezz'ora di ritardo) per un
beneficio che la nostra WebView non può incassare. Il mirroring resta un'aggiunta additiva
per il futuro: il livello dati non passa da lì, quindi introdurlo dopo non richiede di
rifare nulla. Rinuncia consapevole: senza sessione speculare sull'iPhone non si può fare una
Live Activity / Dynamic Island senza rimetterci mano.

## Architettura

Il progetto introduce **un secondo codebase applicativo, nativo**. Finora Swift è servito solo
per plugin sottili; qui nasce una app SwiftUI con schermate proprie, che non condivide una riga
con la SPA Vue. watchOS non esegue WebView e Capacitor non ha un target per l'orologio: è il
costo strutturale del progetto.

Il target watchOS vive dentro lo stesso progetto Xcode (`frontend/ios/App/App.xcodeproj`), con
bundle id `it.pallade.app.watchkitapp` — obbligatorio, watchOS pretende il prefisso del bundle
id dell'app iPhone. `npx cap sync ios` continua a toccare solo il target `App`.

### Componenti sul Watch

- **`WorkoutController`** — possiede la `HKWorkoutSession`
  (`traditionalStrengthTraining`, `.indoor`) e l'`HKLiveWorkoutBuilder`. Unico a parlare con
  HealthKit: espone frequenza cardiaca e calorie come valori osservabili, e a fine
  allenamento salva l'`HKWorkout` in Salute. Non sa nulla di schede né di serie.
- **`PhoneLink`** — unico a parlare con l'iPhone (`WCSession`). Riceve la cache delle schede,
  invia le serie completate, chiede lo stato all'aggancio. Non sa nulla di HealthKit.
- **`SessionStore`** — stato locale della sessione: scheda, giornata, insieme delle serie
  completate. Unico posto dove avviene la fusione con quanto arriva dall'iPhone.
- **UI SwiftUI** — tre schermate: scelta scheda/giornata, esecuzione (esercizio corrente,
  valori suggeriti, tasto "fatto"), recupero (countdown + háptica).

### Componenti sull'iPhone

- **`WatchLinkPlugin.swift`** — delegate `WCSession` lato iOS, unico punto di contatto col
  Watch, gemello di `PhoneLink`. Fa una cosa che il resto non può fare: **bufferizza**. Quando
  arriva una serie completata e la WebView è sospesa, la accumula in memoria e su disco, e la
  consegna al JS quando la WebView torna viva. Senza questo buffer ogni serie chiusa a schermo
  spento sarebbe persa.
  - Interfaccia: `isSupported()`, `pushCatalog(payload)`, `sendSetDone(payload)`,
    `sendSessionState(payload)`, `drainBuffer()`.
  - Eventi emessi: `setDone`, `biometrics`, `sessionStartedOnWatch`, `watchReachability`.

### Componenti web

- **`frontend/src/lib/watch.js`** — wrapper platform-agnostic, stesso pattern di
  `lib/healthkit.js`: su browser/PWA ritorna `supported: false`. Unica sorgente che la UI
  importa.
- **`frontend/src/lib/session-merge.js`** — la fusione come **funzione pura**, isolata dalla
  vista perché è l'unica logica non banale del progetto e deve essere testabile da node.
- **`frontend/src/views/member/SessionView.vue`** — consuma gli eventi del wrapper e invia il
  proprio "fatto" al Watch. Continua a funzionare integralmente senza orologio.
- **`frontend/src/lib/data/sessions.js`** — nuova `createSessionFromSnapshot()`.

Nulla di esistente viene riscritto. `HealthKitLivePlugin` resta com'è e continua a produrre lo
snapshot biometrico da Salute, perché il Watch scrive lì l'`HKWorkout`.

## Modello dati

### Identità stabile delle serie

Oggi le serie sono referenziate per **posizione** (`sets_log[i]`) e sull'iPhone si possono
aggiungere o togliere righe: un messaggio dal Watch che dice "fatta la serie 2 dell'esercizio
3" può atterrare sulla riga sbagliata se nel frattempo gli indici si sono spostati.

Ogni riga di `sets_log` riceve quindi un **`uid`** (stringa breve, generata alla creazione
dello snapshot). Il protocollo fra i dispositivi referenzia sempre `uid`, mai indici. Questo
elimina l'intera classe di bug degli indici posizionali. Le sessioni create prima di questa
modifica non hanno `uid`: il Watch le rifiuta con un messaggio esplicito invece di indovinare.

Le chiavi posizionali di `restEndsAt` e delle notifiche di recupero (`${exI}_${rowI}`)
restano come sono: sono locali alla vista iPhone e non attraversano il confine fra dispositivi.

### Il timer di recupero non è uno stato

`SessionView.vue` tratta già il recupero come **scadenza assoluta** (`restEndsAt`, epoch ms),
non come contatore, perché la WebView viene sospesa. Il Watch calcola la stessa scadenza da
`done_at + rest_seconds`: i due dispositivi convergono senza scambiarsi il timer, e non c'è
deriva da correggere. Nessun campo nuovo, nessun messaggio dedicato.

### Fusione: insieme accrescitivo con timestamp

Una serie completata è un fatto con un timestamp. La fusione fra lo stato del Watch e quello
dell'iPhone è quindi l'**unione** delle serie fatte, con queste regole:

1. Una serie `done` vince su una non `done`. Il "fatto" è idempotente: rifare la stessa serie
   non significa nulla.
2. Se entrambi i lati la riportano `done`, vince il **`done_at` più vecchio**, con i suoi
   `reps`/`load`/`incline`.
3. Un "annulla" (`done: false`) è un'operazione **solo iPhone** e non viaggia dal Watch, così
   non esiste un caso in cui i due lati si contraddicono su un fatto già accaduto.

Conseguenza accettata: se la stessa serie viene chiusa su entrambi i dispositivi mentre sono
scollegati, i valori del più recente vanno persi. È raro e senza danno — sono gli stessi
valori suggeriti.

La fusione vive in `session-merge.js` come funzione pura e viene **replicata in Swift** nel
`SessionStore`. È l'unica duplicazione di logica del progetto: mitigata dal fatto che le tre
regole sopra sono la specifica normativa, e che entrambe le implementazioni vengono provate
sugli stessi casi.

### Correlazione fra sessione al polso e riga Supabase

Una sessione nata sul Watch non ha ancora un id Supabase. Chi la apre genera un
**`client_session_id`** (UUID) che accompagna ogni messaggio.

Migration: colonna `client_session_id uuid` su `workout_sessions`, con **indice unico
parziale** su `(member_id, client_session_id)` dove non nullo. Serve a rendere la
materializzazione **idempotente**: se il buffer viene svuotato due volte — cosa che succede se
l'app viene uccisa a metà — non nascono due sessioni gemelle. La RLS esistente su
`workout_sessions` copre già la proprietà della riga; la colonna va aggiunta ai campi
scrivibili in `sessions.js`.

`createSessionFromSnapshot()` accetta lo snapshot già risolto invece di ricalcolarlo. È il
motivo per cui esiste: `startSession()` precompila i carichi interrogando le ultime 30
sessioni, e rifare quel calcolo sull'iPhone farebbe **cambiare sotto gli occhi dell'utente**
numeri che aveva appena confermato al polso.

## Flusso dati

### Cache: iPhone → Watch

Quando l'app iPhone è in primo piano e la sessione utente è valida, spinge al Watch le schede
attive del member con i carichi **già pre-risolti** (stessa logica di `startSession`, estratta
in una funzione riusabile). Trasporto: `updateApplicationContext`, che conserva solo l'ultimo
stato — semantica giusta per una cache, e nessuna coda da svuotare.

Il payload contiene solo ciò che serve al polso: titolo scheda, giornate, nome esercizio,
serie, ripetizioni, secondi di recupero, `load_type`, valori suggeriti. Niente immagini,
niente istruzioni, niente catalogo completo.

Limite accettato: se il trainer cambia la scheda e l'utente non riapre l'app iPhone, al polso
resta la versione precedente. La schermata di scelta al polso mostra la data dell'ultima
sincronizzazione.

### Sessione avviata dal Watch

1. L'utente sceglie scheda e giornata al polso; il `SessionStore` genera `client_session_id` e
   costruisce lo snapshot dalla cache.
2. `WorkoutController` apre la `HKWorkoutSession`. Da qui l'app è viva in background.
3. `PhoneLink` invia `session_started` con lo snapshot completo. Se l'iPhone non è
   raggiungibile il messaggio viene accodato: l'allenamento parte comunque.
4. Il plugin iPhone riceve, bufferizza. Alla prima apertura della WebView il JS chiama
   `createSessionFromSnapshot()` e la sessione compare su `SessionView` già popolata.
5. A ogni "fatto" il Watch avvia il recupero (háptica alla scadenza) e invia `set_done`.
6. A fine allenamento il Watch chiude la `HKWorkoutSession` e salva l'`HKWorkout`. L'iPhone,
   alla riapertura, completa la sessione e ricava lo snapshot biometrico con
   `HealthKitLivePlugin.summary()` — codice già esistente, invariato.

### Sessione avviata dall'iPhone, aggancio del Watch

Flusso odierno immutato. Quando l'utente apre la app al polso, `PhoneLink` chiede lo stato
(`state_request`); l'iPhone risponde con snapshot e serie già fatte, il Watch apre la sua
`HKWorkoutSession` e da lì in poi vale tutto.

Conseguenza esplicita: le calorie e la frequenza cardiaca del workout coprono **dall'aggancio
in poi**, non dall'inizio della sessione. È corretto — prima di quel momento non c'era un
workout attivo — e va detto nell'interfaccia.

### Protocollo

| Messaggio | Verso | Trasporto | Motivo |
| --- | --- | --- | --- |
| `catalog` | iPhone → Watch | `updateApplicationContext` | Solo l'ultimo stato conta |
| `session_started` | entrambi | `transferUserInfo` | Non deve andare perso |
| `set_done` | entrambi | `transferUserInfo` | Accodato, ordinato, sopravvive alla app chiusa |
| `session_closed` | entrambi | `transferUserInfo` | Non deve andare perso |
| `state_request` | Watch → iPhone | `sendMessage` + reply | Serve una risposta immediata |
| `biometrics` | Watch → iPhone | `sendMessage` | Best effort: un HR vecchio non serve, si scarta |

La scelta per riga è sempre la stessa domanda: *questo dato, se arriva in ritardo, vale
ancora qualcosa?* I biometrici no, e non vanno accodati — accodarli riempirebbe la coda di
valori inutili ritardando quelli veri.

A `state_request` risponde il **plugin nativo dalla propria copia persistita**, non il
JavaScript: la richiesta arriva tipicamente a schermo spento, quando la WebView è sospesa e
non può rispondere entro il tempo utile. Il plugin è quindi tenuto a mantenere su disco lo
stato corrente della sessione, aggiornandolo a ogni `set_done` che passa in entrambi i versi.

## Gestione degli errori

- **Sessione di allenamento già attiva altrove.** Se l'utente ha un allenamento aperto
  nell'app Allenamento, l'avvio va in errore o — per il difetto storico — resta appeso. La
  chiamata ha un **timeout esplicito**: scaduto, si mostra "hai un allenamento attivo nell'app
  Allenamento, terminalo per continuare" invece di una schermata bloccata.
- **Permessi HealthKit negati al polso.** Senza autorizzazione a scrivere workout non si apre
  la sessione, quindi niente background. L'app lo dice apertamente: si può usare come vista
  passiva a schermo acceso, ma i dati non vengono registrati e l'app si sospende quando abbassi
  il polso. Non si finge che funzioni.
- **iPhone non raggiungibile.** L'allenamento prosegue senza degradarsi: `transferUserInfo`
  accoda, HealthKit registra comunque, alla riconnessione tutto arriva. È il caso normale del
  telefono nell'armadietto, non un'eccezione.
- **Cache assente o vuota.** Schermata esplicita: "apri l'app sull'iPhone per sincronizzare le
  schede". Nessun tentativo di indovinare.
- **Sessione senza `uid` sulle serie** (creata prima di questa modifica): il Watch la rifiuta
  con un messaggio, invece di agganciarsi a indici che non può correlare.
- **Buffer svuotato due volte.** Coperto dall'indice unico su `client_session_id`.

## Test

Non esistono test unitari configurati; la verifica segue il pattern del repo.

- **`session-merge.js`** — script e2e usa-e-getta (`scripts/tmp-*.mjs`, gitignorato) che
  importa il modulo vero ed esercita le tre regole di fusione, inclusi gli scenari di conflitto
  e di scollegamento prolungato.
- **`createSessionFromSnapshot()`** — stesso pattern, contro Supabase locale: verifica che lo
  snapshot arrivi intatto e che il secondo invio con lo stesso `client_session_id` non crei una
  riga gemella.
- **`SessionStore` in Swift** — gli stessi casi della fusione JS, come test XCTest sul target
  watchOS. È l'unico modo di sapere che le due implementazioni concordano.
- **Su device fisico, obbligatorio.** Il simulatore watchOS non ha sensore di frequenza
  cardiaca e la `HKWorkoutSession` vi si comporta diversamente. Vanno provati sul polso: la
  frequenza cardiaca reale, l'esecuzione a schermo spento per un allenamento intero, l'háptica
  di fine recupero, e la riconnessione dopo aver allontanato l'iPhone.

## Fuori scope

Mirroring HealthKit e Live Activity; complicanze e Smart Stack; Watch cellular autonomo senza
iPhone accoppiato; modifica di carichi e ripetizioni al polso; Apple Watch come unico
dispositivo (l'app iPhone resta un prerequisito di installazione).

## Rischi aperti

- **Provisioning.** Un target watchOS richiede un secondo App ID. Il team personale gratuito
  ne concede un numero limitato e i profili scadono in 7 giorni; che la combinazione
  App ID watch + entitlement HealthKit passi con il provisioning free **non è verificato**. Da
  provare per primo, prima di scrivere UI: se non passa, il progetto richiede l'Apple Developer
  Program a pagamento per essere testato.
- **`npx cap sync ios` e il progetto Xcode.** Va verificato che la sincronizzazione non
  rimuova né alteri il target watchOS aggiunto a mano.
- **Duplicazione della fusione in due linguaggi.** Nessuna mitigazione strutturale possibile
  senza introdurre un livello condiviso sproporzionato al problema; si accetta e si copre con
  test paralleli.
