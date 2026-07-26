# Switch d'ambiente iOS: Supabase locale nel simulatore, cloud sul device

**Data:** 2026-07-26
**Stato:** approvato

## Problema

L'app iOS è un bundle statico (`webDir: dist`, nessun `server.url` in
`capacitor.config.ts`): le variabili `VITE_*` sono cotte nel build, quindi lo stesso
binario non può distinguere simulatore da device senza una decisione a runtime.

Serve che l'app usi **Supabase locale (e backend locale) nel simulatore** — per sviluppare
contro i dati di seed — e **Supabase Cloud + backend di produzione sul device fisico**.

Inoltre `frontend/.env.production` contiene `VITE_API_BASE_URL=http://localhost:3000`:
su un device fisico `localhost` è il telefono stesso, quindi il backend non risponde.

## Approccio scelto

Un solo binario che decide all'avvio. Il bundle contiene **due terne di configurazione**;
all'avvio l'app chiede al layer nativo se sta girando su un simulatore
(`@capacitor/device` → `isVirtual`, che su iOS mappa `targetEnvironment(simulator)`) e
sceglie la terna.

Scartato: due build separate (`vite build --mode simulator|production` + due script npm).
Zero codice nuovo, ma lo switch resta manuale e richiede rebuild + `cap sync` a ogni
cambio di target — non è il comportamento richiesto.

## Naming delle variabili

Vite carica un solo file `.env` per build, quindi le due terne devono avere nomi distinti
nello stesso file. La terna esistente resta il **default**; si aggiunge una terna
opzionale con suffisso `_SIM`, usata solo quando si rileva il simulatore iOS.

| Contesto | Terna usata |
|---|---|
| `npm run dev:fe` nel browser | default (`.env` → locale) — invariato |
| `npm run build` per l'EC2 | default (`.env.production` → cloud) — invariato |
| App iOS su **device** | default → cloud |
| App iOS su **simulatore** | `_SIM` → locale |

Il deploy web non cambia. Se la terna `_SIM` manca, il simulatore ricade sul default:
il comportamento attuale, non una rottura.

Variabili: `VITE_SUPABASE_URL_SIM`, `VITE_SUPABASE_ANON_KEY_SIM`, `VITE_API_BASE_URL_SIM`.

## Componenti

### `frontend/src/lib/runtime-config.js` (nuovo)

- `initRuntimeConfig()` — async, idempotente. Se `Capacitor.getPlatform() === 'ios'`
  chiama `Device.getInfo()` e sceglie in base a `isVirtual`; altrimenti default.
  Valida la terna risolta e la memorizza.
- `getRuntimeConfig()` — sincrono; lancia se chiamato prima dell'init.

Non conosce Supabase: risolve solo la configurazione. È `main.js` a concatenare
`initRuntimeConfig()` e `initSupabase()`.

### `frontend/src/lib/supabase.js`

Da `export const supabase = createClient(…)` a `export let supabase` più
`initSupabase()`. I cinque file che lo importano non cambiano: nessuno lo usa a livello
di modulo (tutti gli usi sono dentro funzioni), e i live binding ES propagano
l'assegnazione.

**Nessuno `storageKey` custom.** Il design iniziale ne prevedeva uno per ambiente, ma
supabase-js lo deriva già come `sb-${hostname.split('.')[0]}-auth-token`: locale
(`sb-127-auth-token`) e cloud (`sb-<ref>-auth-token`) sono quindi già separati.
Impostarlo a mano avrebbe invalidato le sessioni esistenti sul web, disconnettendo tutti
gli utenti al primo deploy.

### `frontend/src/lib/api.js`

`BASE` letto da `getRuntimeConfig()` dentro `apiFetch`, non a import-time.

### `frontend/src/main.js`

`initRuntimeConfig()` prima di `auth.init()` e del mount. Concatenazione con `.then()`,
non top-level await, per non dipendere dal build target.

### File env

- `.env` — aggiunta terna `_SIM` (uguale al default: in dev locale sono già entrambe locali).
- `.env.production` — aggiunta terna `_SIM` che punta al locale; correzione di
  `VITE_API_BASE_URL` a `https://52-49-165-160.sslip.io` (Caddy fa reverse proxy di
  `/api/*` su Fastify; i path in `api.js` includono già `/api`).
- `.env.production.example` — stessa struttura, con segnaposto.

### Dipendenza

`@capacitor/device@^6` (allineato a Capacitor 6) + `npx cap sync ios`.

## Gestione errori

- `Device.getInfo()` che fallisce (plugin non sincronizzato, versione incompatibile) →
  `console.warn` e fallback sul **default/cloud**, non sul locale: un device che parte
  puntando a `127.0.0.1` è completamente inutilizzabile, mentre un simulatore che parte
  sul cloud funziona.
- Terna default mancante o incompleta → l'app **non** viene montata (come oggi, che
  lanciava a import-time), con l'errore in console e a schermo: su device non c'è una
  console a portata di mano e uno schermo bianco non è diagnosticabile.
- Terna `_SIM` incompleta su simulatore → `console.warn` e uso del default.
- Sessione non ripristinabile (rete assente) → l'app viene montata comunque e mostra la
  login, come nel comportamento attuale (`.finally`).
- All'avvio l'ambiente scelto viene loggato, così è verificabile dalla console del WebView.

Non gestibile in codice: se nel simulatore mancano `supabase start` o `npm run dev:be`,
le chiamate falliscono per rete. È una condizione dell'ambiente di sviluppo.

## Verifica

Nessun test unitario configurato nel progetto. Verifica manuale in tre passi:

1. **Browser** (`npm run dev:fe`) — login con utente di seed: nessuna regressione.
2. **Simulatore** — `npm run build && npx cap sync ios`, run da Xcode: la console mostra
   l'ambiente `sim` e il login con `member@gym.local` funziona (utente presente solo in locale).
3. **Device fisico** — la console mostra l'ambiente cloud e il login con un utente cloud
   funziona. Richiede un iPhone collegato con signing configurato.

`NSAllowsLocalNetworking` è già presente in `Info.plist`, quindi ATS non blocca le
chiamate HTTP verso `127.0.0.1:54321` e `localhost:3000` dal simulatore.

## Prerequisito fuori dal repo

Sull'EC2 `CORS_ORIGIN` deve includere `capacitor://localhost`, altrimenti il device viene
bloccato dal CORS sulle chiamate `/api/*` (già documentato in `DEPLOY.md`). Va verificato
sul server: non è nel repo.
