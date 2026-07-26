# Badge stato servizi (dashboard admin) — Design

Data: 2026-07-26
Stato: approvato

## Obiettivo

Dare all'admin, dalla propria dashboard, una risposta immediata a due domande:
**a quale ambiente è connessa questa copia dell'app** e **i servizi rispondono**.

Il caso che motiva la feature è successo il 26/07: l'app sul device girava la 1.3.0
mentre in produzione c'era ancora la 1.2.0. Il backend vecchio ignorava in silenzio un
campo che non conosceva — `PATCH` 200, dato mai scritto, nessun errore da nessuna parte —
e la diagnosi è costata parecchio tempo. Un badge che avesse mostrato
«app 1.3.0 · backend 1.2.0» l'avrebbe chiusa in dieci secondi.

Da qui la scelta di dare al **confronto delle versioni** lo stesso peso dello stato di
salute: un servizio raggiungibile ma vecchio è il guasto silenzioso, mentre uno
irraggiungibile si manifesta da sé.

## Decisioni prese (brainstorming)

- **Scopo doppio**: ambiente + raggiungibilità (non solo uno dei due).
- **Contenuto**: backend (URL, stato, latenza), Supabase (URL, stato), ambiente e
  versione app, sessione (ruolo e scadenza token).
- **Presentazione**: badge compatto espandibile, non card sempre aperta né pagina
  separata. La dashboard resta dedicata alle statistiche.
- **Approccio ibrido**: le sonde di raggiungibilità partono dal client (è il punto di
  vista che conta: se è il telefono a non raggiungere il backend, si deve vedere), ma la
  versione e lo stato del database li dichiara il backend.

## Architettura

Due unità, per separare raccolta dati e presentazione.

### `frontend/src/lib/diagnostics.js`

Nessuna UI. Espone `collect()`, che lancia le sonde in parallelo e restituisce:

```js
{
  backend:  { url, ok, latencyMs, version, uptimeS, error },
  supabase: { url, ok, latencyMs, error },
  environment: { source, isSimulator, appVersion },
  session: { role, expiresAt },
}
```

Testabile in isolamento e riusabile se la diagnostica servirà altrove.

### `frontend/src/components/ServiceStatusBadge.vue`

Solo presentazione: invoca `collect()`, gestisce collassato/espanso e il refresh
manuale. Montato in cima a `views/admin/DashboardView.vue`, sopra `IdentityCard`.

Non va nel layout condiviso: vive solo nella dashboard admin, che è già riservata per
ruolo, quindi non serve un controllo di ruolo lato UI. La protezione vera resta sulla
rotta backend.

### `backend/src/routes/diagnostics.js`

```
GET /api/admin/diagnostics    preHandler: [authenticate, requireRole('admin')]
→ { version, database: { ok, latency_ms }, uptime_s }
```

`version` dal `package.json` del backend, `database` da una query minima via
`supabaseAdmin`, `uptime_s` da `process.uptime()` — dice se il deploy ha davvero
riavviato il servizio.

`/api/health` resta **invariato**: pubblico e anonimo. Tutto ciò che descrive
l'infrastruttura sta dietro il controllo di ruolo.

## Le quattro sonde

| Blocco | Come | Perché così |
|---|---|---|
| Backend | `GET /api/health` con `performance.now()` attorno alla fetch, poi `GET /api/admin/diagnostics` | L'health esiste già; la seconda aggiunge versione e stato DB |
| Supabase | `supabase.from('exercises').select('id').limit(1)` | Attraversa rete, chiave anon **e** RLS: le tre cose che si rompono davvero. Un ping HTTP direbbe solo che il server è vivo |
| Ambiente | `getRuntimeConfig()` (`source`, `isSimulator`, URL) + `__APP_VERSION__` | Già in memoria, costo zero |
| Sessione | `supabase.auth.getSession()` → `expires_at`; ruolo da `authStore` | Nessuna chiamata di rete |

La versione dell'app arriva da un `define` in `vite.config.js` che inietta
`__APP_VERSION__` dal `package.json`: resta allineata da sola a ogni release.

## Semantica degli stati

Tre livelli, perché due non distinguono il caso interessante:

- **verde** — tutto risponde e le versioni combaciano
- **giallo** — i servizi rispondono ma qualcosa non torna: versione del backend diversa
  da quella dell'app (o non dichiarata, vedi 404 più sotto), oppure latenza di **almeno
  una** delle due sonde oltre **1500 ms**
- **rosso** — un servizio non risponde

Il giallo è la ragione d'essere della feature: è lo stato in cui il sistema *sembra*
funzionare.

## Errori e casi limite

**Backend più vecchio dell'app (il caso che conta).** Se in produzione gira una versione
precedente, `/api/admin/diagnostics` non esiste e risponde **404**. Non va trattato come
guasto: significa «backend più vecchio dell'app» e si mostra **giallo** con quel testo.
Interpretarlo come errore rosso farebbe fallire lo strumento proprio nello scenario per
cui è stato costruito.

Gli altri:

- **Timeout** di 5 s per sonda con `AbortController`: una rete mobile lenta non deve
  lasciare il badge appeso.
- **Sonde indipendenti**: ognuna cattura i propri errori. Supabase giù non deve impedire
  di vedere lo stato del backend.
- **Nessun segreto**: si mostrano gli URL, mai la anon key.
- **Refresh manuale**, nessun polling: consumerebbe batteria e rete per un dato che
  serve solo quando lo si cerca.
- **Sessione assente o scaduta**: il blocco sessione mostra lo stato senza andare in
  errore; il badge resta utilizzabile.

## Verifica

Script e2e usa-e-getta contro il backend locale (pattern del progetto):

1. login come **admin** → `GET /api/admin/diagnostics` → 200 e forma della risposta
   corretta (`version`, `database.ok`, `uptime_s`);
2. login come **member** → atteso **403**. È il controllo che conta davvero: una rotta
   diagnostica aperta ai non-admin esporrebbe informazioni sull'infrastruttura.

Poi verifica manuale sul device: il badge deve mostrare `cloud`, latenze reali, e le
versioni a confronto.

## Fuori ambito

- Storico o grafici delle latenze: serve una risposta puntuale, non un monitoraggio.
- Polling automatico o notifiche di servizio giù.
- Badge per ruoli diversi da admin.
- Diagnostica di HealthKit: appartiene alla schermata di allenamento, non a questa.
