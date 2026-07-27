# Handover — riprendere lo sviluppo su un altro PC

Tutto ciò che serve per rimettere in piedi **sviluppo locale** e **rilascio** partendo da
zero su una macchina nuova. Per architettura e convenzioni del codice vedi `CLAUDE.md`;
per la procedura di rilascio completa vedi `DEPLOY.md`.

> **Cambio di architettura (2026-07-27).** Il progetto girava su EC2 con Caddy e un backend
> Fastify. Ora non esiste alcun server applicativo: l'app è statica su Cloudflare Pages e
> parla direttamente con Supabase. Sono stati eliminati `backend/`, `deploy/`, `terraform/`
> e il workflow di deploy via SSH. Il perché sta in
> `docs/superpowers/plans/2026-07-27-migrazione-cloudflare-supabase.md`.

---

## 0. Cose che NON sono nel repo

| File | Dove sta | Come recuperarlo |
| --- | --- | --- |
| `frontend/.env` | locale | **Si rigenera** (§2): punta al Supabase locale |
| `.env.local` | locale | Credenziali di servizio del Supabase **locale**, usate dal seed. Si rigenera da `npm run db:status` |
| `.env.production` | locale | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` del progetto **cloud**, usate da `seed:cloud` e dagli script di manutenzione. Si riprendono dal dashboard |
| `supabase/.temp/` | locale | Link della CLI al progetto cloud: si rifà con `npx supabase link --project-ref nayiujdfvevccoluqwic` |
| Secret GitHub | GitHub | `SUPABASE_DB_URL` (Session pooler) e `BACKUP_PASSPHRASE`. La passphrase va conservata **anche fuori da GitHub**: senza, i backup sono illeggibili |

Nessuna chiave AWS, nessuna chiave SSH: non c'è più niente a cui accedere via SSH.

---

## 1. Prerequisiti

| Strumento | Versione | Note |
| --- | --- | --- |
| **Node.js** | **≥ 22** | Vite 8 richiede `@vitejs/plugin-vue` v6+; gli script e2e usano `structuredClone` e `await` a livello di modulo |
| **Docker** | qualsiasi | Serve solo per il Supabase locale |
| **git** | qualsiasi | Con `git-flow` (AVH) se vuoi usare gli stessi comandi di release |
| GitHub CLI (`gh`) | opzionale | Solo per pubblicare le release |
| Xcode + Mac | — | Solo per l'app iOS (vedi `CLAUDE.md`) |

```bash
# Node 22 (nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc && nvm install 22 && nvm use 22

# Docker (Linux/WSL)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER    # poi ri-login, oppure usa: sg docker -c "..."

# git-flow
sudo apt install -y git-flow
```

---

## 2. Sviluppo locale

```bash
git clone https://github.com/gomutako/gym.git
cd gym
npm install
```

### Avvia il database locale

```bash
npm run db:start     # scarica le immagini Docker la prima volta (qualche minuto)
npm run db:status    # stampa URL e chiavi LOCALI
```

### Crea i file di ambiente con quei valori

`frontend/.env`

```bash
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<publishable key da db:status>
# Coppia usata solo dal simulatore iOS: in dev è identica a quella sopra
VITE_SUPABASE_URL_SIM=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY_SIM=<publishable key da db:status>
```

`.env.local` (alla root — serve al seed, che ha bisogno della service_role key)

```bash
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<publishable key da db:status>
SUPABASE_SERVICE_ROLE_KEY=<secret key da db:status>
```

> Le chiavi locali sono generate dalla CLI e **valgono solo su quella macchina**: non
> riusare quelle del vecchio PC, rileggile con `db:status`.

### Dati demo e avvio

```bash
npm run seed         # admin@gym.local / trainer@gym.local / member@gym.local — pwd: password123
npm run dev:fe       # http://localhost:5173  (unico processo applicativo)
```

### Comandi utili

```bash
npm run db:reset     # ricrea il DB locale riapplicando tutte le migration
npm run db:stop
npm run build        # build di produzione del frontend
npx supabase functions serve --no-verify-jwt   # runtime locale della Edge Function
```

---

## 3. Produzione — stato attuale

| | |
| --- | --- |
| **Dominio** | **pallade.it** (nameserver su Cloudflare) |
| **App** | Cloudflare Pages, build automatica sul push a `master` |
| **Database / Auth / Storage** | Supabase Cloud, ref `nayiujdfvevccoluqwic`, region `eu-west-1`, Postgres 17 |
| **Codice privilegiato** | una sola Edge Function: `admin-users` (cambio email) |
| **Posta** | Resend come SMTP di Supabase Auth (sender `noreply@pallade.it`, dominio `send.pallade.it`) |
| **Backup** | workflow **DB backup**: `pg_dump` cifrato GPG, ogni giorno |
| **Migrazioni** | workflow **DB migrate**, ad attivazione manuale |
| **Repo** | ⚠️ **pubblico** — `github.com/gomutako/gym` |
| **Server** | nessuno |

### Dove stanno i segreti (nessuno è nel repo)

- **Chiavi Supabase Cloud** → dashboard Supabase, *Project Settings → API*
- **Password del DB** → dashboard, *Project Settings → Database* (non è più visualizzabile
  dopo la creazione: si può solo rigenerare, e non rompe nulla perché l'app usa l'API REST,
  non una connessione Postgres diretta)
- **Secret dei workflow** → GitHub, *Settings → Secrets and variables → Actions*
- **Credenziali SMTP** → dashboard Supabase, non nel repo

> ⚠️ Il repository è **pubblico**: sui repo pubblici gli artifact di GitHub Actions sono
> scaricabili da chiunque. Per questo il backup è **cifrato** e il workflow si rifiuta di
> partire senza `BACKUP_PASSPHRASE`. Se un domani si aggiungono dati di clienti reali,
> valutare di rendere privato il repo.

---

## 4. Rilascio

### Flusso normale

```bash
git flow feature start <nome>     # lavori su develop
# ... commit ...
git flow feature finish <nome>
git push origin develop           # la CI verifica la build

git flow release start 1.0.2
npm version 1.0.2 --no-git-tag-version --workspaces --include-workspace-root
# aggiorna CHANGELOG.md
git commit -am "chore(release): 1.0.2"
GIT_MERGE_AUTOEDIT=no git flow release finish -m "Release 1.0.2" 1.0.2
git push origin develop master --tags
```

Il push su `master` fa partire la build di Cloudflare Pages.

### Migrazioni del database

**Non** vengono applicate dal rilascio dell'app, e vanno **prima** del codice che le usa.
Tre modi, in ordine di preferenza:

```bash
# 1. Workflow GitHub "DB migrate" (Actions → Run workflow, prima con dry_run=true)

# 2. Da locale con il Session pooler (necessario da WSL: l'host diretto è solo IPv6)
export SUPABASE_DB_URL="postgresql://postgres.nayiujdfvevccoluqwic:<PWD>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres"
npm run db:push:dry && npm run db:push

# 3. SQL Editor del dashboard, come ripiego: incollare l'SQL e poi
#    insert into supabase_migrations.schema_migrations (version) values ('<timestamp>');
```

### Edge Function

```bash
npx supabase functions deploy admin-users
```

---

## 5. Gotcha (già costati tempo — non ripeterli)

- **Node ≥ 22**, sempre.
- **La RLS è l'unica difesa.** Il client usa la anon key, che è pubblica: non c'è un backend
  che filtri. Aggiungendo tabelle o colonne, la domanda è "quale policy e quale trigger la
  proteggono?". Vedi la sezione dedicata in `CLAUDE.md`.
- **`[analytics] enabled` in `supabase/config.toml` deve restare `false`**: su WSL2 i
  container Logflare/Vector non superano l'healthcheck e bloccano `supabase start`. Un
  aggiornamento della CLI può riscriverlo a `true`.
- **Supabase Cloud da rete IPv4** → serve il Session pooler (§4): `db.<ref>.supabase.co`
  pubblica solo record AAAA.
- **Shell non nel gruppo `docker`** → prefissa `sg docker -c "npm run db:start"`. Su macOS
  `sg` non esiste: comandi diretti.
- ⚠️ **`ps | grep | kill` si auto-matcha** quando la shell sta eseguendo il comando cercato
  (es. `cap sync ios`): filtra con `awk '/pattern/ && !/zsh/ && !/awk/ {print $1}'`.
- ⚠️ **`npm install <pacchetto>` pota il binding nativo di Rolldown** e `vite build` resta
  appeso per sempre senza stampare nulla. Cura: `npm install` nudo dalla root.
- **`vite build` non termina da solo**: verifica l'artefatto (`frontend/dist/sw.js` è
  l'ultimo prodotto) e chiudi per PID. Non usare `| tail`: la pipe bufferizza.
- **Free tier Supabase**: i progetti inattivi per ~1 settimana vengono **messi in pausa** (si
  riattivano dal dashboard) e non ci sono backup automatici — per questo esiste il workflow.
- **Verifica**: non ci sono test unitari. Si usano script e2e usa-e-getta (`scripts/tmp-*.mjs`,
  gitignorati) che importano i **moduli veri** di `frontend/src/lib/data/` e girano contro
  Supabase locale.

---

## 6. Casi di emergenza

**Ho perso `BACKUP_PASSPHRASE`**
Gli archivi già caricati diventano illeggibili: non c'è recupero. Genera una passphrase
nuova, aggiorna il secret e lancia il workflow a mano per avere subito un backup valido.
I vecchi artifact si possono cancellare.

**Ho perso la password del database**
Rigenerala dal dashboard (*Project Settings → Database*). Non rompe l'app: il client usa
l'API REST con la anon key, non una connessione Postgres. Va solo aggiornato il secret
`SUPABASE_DB_URL` su GitHub.

**Il progetto Supabase è in pausa**
Free tier: si riattiva dal dashboard. L'app resta ferma finché non riparte.

**La build di Pages fallisce**
Guarda i log su Cloudflare. Cause tipiche: variabili `VITE_*` mancanti nel progetto Pages,
oppure Node non impostato a 22.

**Un dato "non si salva" e nessuno segnala errori**
Sintomo classico di una migrazione non applicata in cloud: il client scrive una colonna che
lì non esiste. Controlla lo stato con `npm run db:push:dry`.
