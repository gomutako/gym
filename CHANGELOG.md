# Changelog

Tutte le modifiche rilevanti a questo progetto sono documentate qui.
Formato basato su [Keep a Changelog](https://keepachangelog.com/it/1.1.0/),
versionamento [SemVer](https://semver.org/lang/it/).

## [Non rilasciato]

## [1.5.0] — 2026-07-27

Nuova identità visiva — rosa antico dal primario alle icone — e navigazione nativa
nell'app iOS.

### Aggiunto
- **Tab bar nativa su iOS**: nell'app la navigazione è ora una `UITabBar` di sistema —
  blur, tipografia e safe area gestite da UIKit — mentre il web continua a usare la barra
  HTML. Le voci restano definite in un unico modulo condiviso (`lib/nav-tabs.js`), così
  non possono divergere fra le due implementazioni.
- **Icona dell'app e schermate di avvio col marchio del login**, in rosa antico: erano
  ancora il manubrio indigo e la splash predefinita di Capacitor. Le splash hanno una
  variante chiara e una scura, e sono generate da `scripts/make-app-icon.py`, che legge gli
  hex dalla palette — così un cambio di brand le rifà tutte con un comando.

### Corretto
- **I campi data non sbordano più**: su iOS hanno una larghezza minima propria che `w-full`
  non riusciva a ridurre, così invadevano il campo accanto (data di nascita, inizio e fine
  di un abbonamento, data e ora di un corso) e risultavano anche più alti degli altri. Le
  combobox compatte sono state allineate all'altezza degli altri campi.
- **Le modali e le liste delle combobox non scappano più con la tastiera aperta**: la
  modale si ancora al viewport visibile invece che a quello di layout, quindi resta
  nell'area libera sopra la tastiera. Resta un caso noto: in alcune situazioni la lista
  della combobox si sgancia dal proprio campo finché non si scorre.
- **Il fondo nativo dell'app iOS non è più nero**: quello predefinito era il colore di
  *sistema*, quindi con iOS in tema scuro restava nero anche con l'app in tema chiaro, e si
  notava nella zona di rimbalzo dello scroll. Ora è il fondo pagina vero e segue il tema
  scelto nell'app, login compreso.

### Modificato
- **Nuovo schema cromatico rosa antico**: il primario passa dall'indigo a una scala derivata
  da `#D3919E` che ne conserva la tonalità su dieci passi — la tinta scelta vive su superfici,
  chip, gradienti e tema scuro, i passi profondi portano testo e bottoni (il 300 ha 2,53:1 sul
  bianco, il 600 ne ha 5,11). La stessa tinta è il colore di selezione della tab bar nativa
  iOS, che ora segue anche il tema scelto nell'app e non quello di sistema.
- **Chip riportate a sistema**: `rose` e `red` dicevano la stessa cosa e resta solo `red`,
  che essendo più freddo del rosa antico continua a leggersi come segnale; le tonalità
  seguono una forma canonica (chip `100`/`700`, banner `50`/`700`); il ruolo *trainer* lascia
  l'indigo del vecchio brand per il celeste. Effetto collaterale: i banner d'errore, che
  erano appena sotto la soglia di leggibilità, ora la superano.

## [1.4.0] — 2026-07-26

Diagnostica di servizio, crediti, e una serie di correzioni all'interfaccia iOS emerse
dall'uso sul device.

### Aggiunto
- **Versione e crediti** in fondo al profilo di ogni utente: fonte del catalogo esercizi
  (free-exercise-db, pubblico dominio), librerie open source con licenza MIT, e una nota
  su come vengono trattati i dati di Apple Health. Le due categorie restano distinte
  perché lo sono anche giuridicamente: la prima è cortesia, la seconda è dovuta.
- **Filtri per ruolo e stato abbonamento** nella sezione Utenti, combinabili con la
  ricerca. Lo stato include "Senza abbonamento", perché le popolazioni sono tre e chi non
  ne ha mai avuto uno non è "scaduto".
- Il **ruolo** nella tabella utenti è ora una chip colorata, con tinte fuori dalla scala
  usata dagli abbonamenti per non farlo leggere come uno stato.
- **Titoli di pagina** su Profilo, Utenti, Prenotazioni, Allena, Esercizi e Corsi.
- **Badge stato servizi** nella dashboard admin: ambiente attivo (cloud o locale), stato
  e latenza di backend e Supabase, versione del backend a confronto con quella dell'app,
  uptime del servizio e scadenza della sessione. Tre livelli — verde, giallo, rosso —
  dove il giallo segnala il caso in cui tutto risponde ma le versioni non combaciano: è
  il guasto che non si manifesta da sé, perché un backend più vecchio scarta in silenzio
  i campi che non conosce. Alimentato dalla nuova rotta `GET /api/admin/diagnostics`,
  protetta da `requireRole('admin')`; `/api/health` resta pubblico e invariato.
- La descrizione dell'esecuzione nella card dell'esercizio è **troncata** (un passo, o due
  righe di testo discorsivo) con un **"Leggi tutto"** allineato a destra: durante
  l'allenamento servono a colpo d'occhio le serie, non una decina di passi di istruzioni.
  Il tasto compare solo quando c'è davvero altro da leggere, e cambiando esercizio la
  descrizione torna corta da sola.

### Corretto
- **Il contenuto finiva incollato alla tab bar**: `pb-24` (96px) copriva a malapena la
  nav, che è alta ~61px **più** `env(safe-area-inset-bottom)` (34px sui device con home
  indicator). Ora la safe-area entra nel calcolo del padding invece di essere assorbita.
- **Lo scroll si fermava di colpo, senza rimbalzo di fine lista**: Capacitor forza
  `scrollView.bounces = false` in `CAPBridgeViewController` e non espone un'opzione per
  cambiarlo, quindi nessuna regola CSS poteva ripristinarlo. Sovrascritto in
  `ViewController.viewDidLoad()`; rimosso anche `overscroll-behavior-y: none`, che
  bloccava la stessa elasticità dal lato web.
- iOS zoomava sul campo a ogni focus: la maggior parte dei form usa `text-sm` (14px) e
  sotto i 16px la WKWebView ingrandisce da sé. Bloccata la scala nel meta viewport
  (`maximum-scale=1, user-scalable=no`), come nel template Capacitor. Nota: Safari mobile
  ignora `user-scalable` dal 2016, quindi sul sito web lo zoom sui campi resta.
- L'**intestazione del profilo** occupava mezzo schermo prima di mostrare un dato utile:
  avatar e dati ora sono affiancati, con l'azione di modifica come icona.

## [1.3.0] — 2026-07-26

App iOS nativa e biometrici dell'allenamento letti da Apple Watch via HealthKit.

### Aggiunto
- **App iOS (Capacitor)** che incorpora la SPA come bundle statico (`frontend/ios/App`,
  bundle id `local.gym.app`). Il web resta invariato: tutto il codice HealthKit ha un
  no-op sulle piattaforme non native.
- **Plugin Swift `HealthKitLive`**: stream di frequenza cardiaca ed energia attiva con
  `HKAnchoredObjectQuery`, più `summary()` per media/massimo HR e kcal totali sulla
  finestra della sessione.
- **Badge live HR/kcal** nella schermata di allenamento, con **snapshot salvato** a fine
  sessione nella nuova colonna `workout_sessions.biometrics_json`
  (`{ hr_avg, hr_max, active_kcal }`), così i valori restano visibili nello storico.
- **Switch d'ambiente a runtime**: l'app è un bundle statico e contiene due terne di
  variabili, scelte all'avvio via `@capacitor/device` → simulatore su Supabase e backend
  locali, device fisico e web sul cloud.

### Corretto
- Il plugin `HealthKitLive` non era registrato nel bridge Capacitor: le chiamate dal JS
  non raggiungevano il codice nativo
- Il badge "in attesa di dati dal Watch" non diventava reattivo allo scorrere del tempo
- Parsing delle date ISO con 6 decimali (come le serializza PostgREST), scoping della
  query alla finestra di sessione, isolamento degli errori e una race condition emersi
  dalla review

### Note
- L'anchor dello stream è l'inizio della sessione, non l'istante di apertura della
  schermata: **watchOS sincronizza i campioni sull'iPhone a blocchi con qualche minuto di
  ritardo**, quindi i primi minuti di allenamento non mostrano badge live, ma i dati
  vengono poi recuperati retroattivamente senza perdite.

## [1.2.0] — 2026-07-25

Catalogo esercizi completo, libreria di modelli di scheda e sezione clienti per i trainer.

### Aggiunto
- **Catalogo esercizi completo**: il seed importa l'intero free-exercise-db (~873 voci)
  con metadati tradotti in italiano, tutte le immagini in carousel, istruzioni passo-passo
  e video curati. Nuovi campi `equipment`, `category`, `force`, `level`, `mechanic`,
  `secondary_muscles`, `instructions`, `image_paths`.
- **Modelli di scheda** (`workout_templates`): libreria di programmi pronti, non legati a
  un cliente, assegnabili con `POST /api/templates/:id/assign` che ne crea una copia.
  Seed di ~8 programmi noti (PPL, Full Body, 5x5, Arnold split…).
- **Sezione Clienti** per i trainer, con anagrafica e schede per singolo cliente.
- Profilo con **dati fisici**: genere, data di nascita, altezza, peso, BMI derivato e note.
- Filtri a combobox negli esercizi (gruppo, attrezzatura, livello, meccanica) e componenti
  condivisi `Modal`, `Combobox`, `WorkoutDaysEditor`, `WorkoutDays`, `IdentityCard`.
- Schede: campi obiettivo e livello, "salva come modello" e "nuova da modello".

### Modificato
- Redesign della schermata di login (logo, gradiente, card).

## [1.1.0] — 2026-07-25

Profilo self-service, abbonamenti come storico di periodi, tema scuro e statistiche.

### Aggiunto
- **Profilo self-service**: `GET`/`PATCH /api/profile` per nome, cognome, telefono e
  avatar, senza poter toccare ruolo o abbonamento. Nome e cognome separati, con
  `full_name` come colonna generata.
- **Abbonamenti** come storico di periodi (tabella `subscriptions`), con un trigger che
  mantiene `profiles.subscription_end_date` allineata al periodo più lontano.
- **Tema chiaro / scuro / automatico**, applicato prima del render per evitare il flash.
- **Statistiche di attività** nella dashboard member: allenamenti a settimana, volume e
  gruppi muscolari (`ActivityStats`).
- **Recupero password** con link dal login e vista `/reset-password`.
- Stato delle schede: "in uso" (esclusiva) e "archiviata", con vincolo a livello di
  database che impedisce a una scheda in uso di essere archiviata.
- Pendenza (%) per serie sugli esercizi da tapis roulant; modifica del catalogo esercizi
  via `PATCH /api/exercises/:id`; l'admin può modificare l'email di un utente.
- Immagini reali e video per ogni esercizio nel seed.
- Template email in italiano (recupero, conferma, cambio email) e SMTP di produzione
  documentato — nessun mailserver sull'EC2.
- `HANDOVER.md` per riprendere lo sviluppo su un'altra macchina.

### Modificato
- Viste utenti, schede e storico convertite in tabelle ordinabili e paginate; le `select`
  sostituite dal componente `Combobox`; rimossa la barra del titolo superiore.

## [1.0.1] — 2026-07-24

Prima messa in produzione (EC2 + Supabase Cloud) e correzioni emerse dal deploy reale.

### Modificato
- La produzione usa **Supabase Cloud** (free tier) invece del self-host: l'istanza EC2
  ospita solo backend e frontend, quindi basta una `t3.micro`. In locale resta Supabase CLI.
- Migration remote applicate con la Supabase CLI (`npm run db:push`)
- Senza dominio proprio si usa **sslip.io** come hostname, così Caddy ottiene un
  certificato Let's Encrypt valido (l'app richiede HTTPS per PWA e upload)
- **Node 22** è ora il minimo richiesto (CI, `engines`, provisioning)

### Corretto
- `@supabase/supabase-js` usa la WebSocket nativa: con Node 20 il backend andava in
  crash-loop all'avvio
- Il `git clone` del cloud-init falliva perché `useradd -m` aveva già popolato `/opt/gym`
  con i file skeleton (ora `git init` + `fetch`)
- `/opt/gym` a permessi 750 impediva a Caddy di leggere `frontend/dist` (ora 755)
- Health-check esposto anche su `/api/health`, raggiungibile dall'esterno

## [1.0.0] — 2026-07-24

Prima release di **Gym Manager**, web app mobile-first per la gestione di una palestra.

### Aggiunto

**Member (cliente)**
- Stato abbonamento (attivo/scaduto) e prenotazione corsi con controllo capacità e anti-doppione
- Scheda di allenamento divisa in **giornate**, con immagine, gruppo muscolare, descrizione dell'esecuzione e video opzionale
- **Allenamento guidato**: scelta scheda + giornata, carosello di card (una per esercizio) sfogliabile con frecce, puntini e swipe
- Registrazione per serie di ripetizioni e carico (kg) o livello di difficoltà, con **precompilazione dai carichi della sessione precedente**
- **Timer di recupero** per serie: riga gialla durante il recupero, verde a completamento
- **Calendario** degli allenamenti effettuati

**Trainer**
- Classi assegnate con lista partecipanti
- Gestione **schede come entità**: creazione, giornate, esercizi per giornata
- **Catalogo esercizi** condiviso: immagine su Storage, descrizione tecnica, video, tipo di carico (peso/livello)

**Admin**
- Gestione utenti: ruoli e scadenza abbonamenti
- Palinsesto corsi (creazione, modifica, eliminazione)
- Report presenze con tasso di riempimento per corso

**Piattaforma**
- Frontend Vue 3 + Vite + Pinia + TailwindCSS, installabile come **PWA**
- Backend Fastify con autenticazione JWT e autorizzazione per ruolo
- PostgreSQL/Supabase con **Row Level Security** come difesa finale, Storage per le immagini

**Deploy**
- Provisioning EC2 via **Terraform** o AWS CLI, con bootstrap `cloud-init`
- Supabase self-host: generazione chiavi, migration idempotenti, creazione primo admin
- Caddy con HTTPS automatico, backend come servizio systemd
- CI/CD con GitHub Actions (CI su `develop`/PR, deploy su `master`)
- Backup giornaliero del database con systemd timer

[Non rilasciato]: https://github.com/gomutako/gym/compare/1.0.1...develop
[1.0.1]: https://github.com/gomutako/gym/compare/1.0.0...1.0.1
[1.0.0]: https://github.com/gomutako/gym/releases/tag/1.0.0
