# Handover — riprendere lo sviluppo su un altro PC

Tutto ciò che serve per rimettere in piedi **sviluppo locale** e **deploy** partendo da zero
su una macchina nuova. Per architettura e convenzioni del codice vedi `CLAUDE.md`;
per la procedura di deploy completa vedi `DEPLOY.md`.

---

## 0. Cose che NON sono nel repo

Sono escluse da git (contengono segreti o stato) e vanno **copiate dal vecchio PC** o rigenerate:

| File | Dove sta | Come recuperarlo |
|---|---|---|
| `terraform/terraform.tfstate` | vecchio PC | **Copialo**: senza, Terraform non sa più che l'infrastruttura esiste (vedi §6) |
| `terraform/terraform.tfvars` | vecchio PC | Ricreabile da `terraform.tfvars.example` |
| `~/.ssh/gym-key.pem` | vecchio PC | Chiave SSH dell'istanza EC2. **Non rigenerabile**: se la perdi, vedi §6 |
| `~/.ssh/gym_ci_key` | vecchio PC | Chiave usata da GitHub Actions. Già dentro i secrets del repo; serve solo se la vuoi rigenerare |
| `~/.aws/credentials` | vecchio PC | Oppure crea un nuovo access key da IAM |
| `backend/.env`, `frontend/.env` | locale | **Si rigenerano** (§2), puntano al Supabase locale |

> Copia sicura da vecchio a nuovo PC: usa una chiavetta o `scp`, non email/chat.
> Dopo la copia: `chmod 600 ~/.ssh/gym-key.pem ~/.ssh/gym_ci_key ~/.aws/credentials`

---

## 1. Prerequisiti

| Strumento | Versione | Note |
|---|---|---|
| **Node.js** | **≥ 22** | Obbligatorio: `@supabase/supabase-js` usa la WebSocket nativa, con Node 20 il backend va in crash-loop |
| **Docker** | qualsiasi | Serve solo per il Supabase locale |
| **git** | qualsiasi | Con `git-flow` (AVH) se vuoi usare gli stessi comandi di release |
| Terraform | ≥ 1.5 | Solo se devi toccare l'infrastruttura |
| GitHub CLI (`gh`) | opzionale | Solo per pubblicare le release |

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

`db:status` mostra qualcosa come:
```
API URL:          http://127.0.0.1:54321
anon key:         eyJhbGciOi...
service_role key: eyJhbGciOi...
Studio URL:       http://127.0.0.1:54323
```

### Crea i due `.env` con quei valori

`backend/.env`
```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<anon key da db:status>
SUPABASE_SERVICE_ROLE_KEY=<service_role key da db:status>
PORT=3000
```

`frontend/.env`
```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<anon key da db:status>
VITE_API_BASE_URL=http://localhost:3000
```

> Le chiavi locali sono generate dalla CLI e **valgono solo su quella macchina**:
> non riusare quelle del vecchio PC, rileggile con `db:status`.

### Dati demo e avvio
```bash
npm run seed         # admin@gym.local / trainer@gym.local / member@gym.local — pwd: password123

npm run dev:be       # backend  http://localhost:3000
npm run dev:fe       # frontend http://localhost:5173   (in un secondo terminale)
```

### Comandi utili
```bash
npm run db:reset     # ricrea il DB locale riapplicando tutte le migration
npm run db:stop
npm run build        # build di produzione del frontend
```

---

## 3. Produzione — stato attuale

| | |
|---|---|
| **App** | https://52-49-165-160.sslip.io |
| **Versione** | 1.0.1 |
| **Server** | EC2 `t3.micro`, region `eu-west-1`, Elastic IP `52.49.165.160` |
| **App sul server** | `/opt/gym`, utente di servizio `gym` |
| **Database** | Supabase Cloud, project ref `nayiujdfvevccoluqwic` |
| **HTTPS** | Caddy + Let's Encrypt sull'hostname sslip.io |
| **Repo** | pubblico — `github.com/gomutako/gym` |

### Dove stanno i segreti (nessuno è nel repo)
- **Chiavi Supabase Cloud** → dashboard Supabase, *Project Settings → API*
- **Chiavi in produzione** → sul server in `/opt/gym/backend/.env` (chmod 600)
- **Secrets del deploy** → GitHub repo, *Settings → Secrets and variables → Actions*
  (`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`)

### Accesso al server
```bash
ssh -i ~/.ssh/gym-key.pem ubuntu@52.49.165.160     # amministrazione (sudo)
ssh -i ~/.ssh/gym_ci_key gym@52.49.165.160         # utente applicativo

sudo systemctl status gym-backend     # stato backend
sudo journalctl -u gym-backend -f     # log in tempo reale
```

---

## 4. Deploy

### Flusso normale (automatico)
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
Il push su `master` fa partire la GitHub Action che rilascia in produzione (~1 min).

### Migration del database
**Non** vengono applicate dal deploy dell'app. Quando aggiungi una migration:
```bash
npx supabase login
npx supabase link --project-ref nayiujdfvevccoluqwic
npm run db:push
```
⚠️ Se la tua rete è **solo IPv4**, il `link`/`push` diretto fallisce (l'endpoint
`db.<ref>.supabase.co` è solo IPv6). Usa la stringa del **pooler**, dal dashboard
*Project Settings → Database → Connection pooling*:
```bash
npx supabase db push --db-url "postgresql://postgres.nayiujdfvevccoluqwic:<PWD>@aws-0-eu-west-1.pooler.supabase.com:6543/postgres"
```

### Deploy manuale (se serve)
```bash
ssh -i ~/.ssh/gym-key.pem ubuntu@52.49.165.160
cd /opt/gym && sudo -u gym ./deploy/deploy.sh
```

---

## 5. Gotcha (già costati tempo — non ripeterli)

- **Node ≥ 22**, sempre. Con Node 20 il backend non parte proprio.
- **Niente dominio → sslip.io.** L'app *richiede* HTTPS: il service worker della PWA e
  `crypto.randomUUID()` (usato negli upload immagini) esistono solo in *secure context*.
  Let's Encrypt non emette certificati per IP nudi, quindi si usa `<IP-con-trattini>.sslip.io`.
- **Supabase Cloud da rete IPv4** → serve il pooler (vedi §4).
- **Shell non nel gruppo `docker`** → prefissa: `sg docker -c "npm run db:start"`.
- ⚠️ **Mai** `pkill -f "backend/src/server.js"`: il pattern matcha la riga di comando della
  shell stessa → si auto-termina (exit 144, nessun output). Avvia con
  `node backend/src/server.js & SVPID=$!` e chiudi con `kill $SVPID`.
- **Free tier Supabase**: i progetti inattivi per ~1 settimana vengono **messi in pausa**
  (si riattivano dal dashboard) e non ci sono backup automatici.
- **Verifica**: non ci sono test unitari. Si usano script e2e usa-e-getta — un file `.mjs`
  temporaneo che fa login con gli utenti seed e chiama il backend, poi si cancella.

---

## 6. Casi di emergenza

**Ho perso `terraform.tfstate`**
Terraform non sa più che l'infrastruttura esiste (un `apply` proverebbe a ricrearla).
Puoi reimportare le risorse esistenti:
```bash
cd terraform
terraform import aws_instance.gym       i-07233797ea762906a
terraform import aws_security_group.gym sg-0cfc0d9fce70b81bb
terraform import aws_eip.gym            eipalloc-0a1e321748b8bcf4c
```
In alternativa gestisci l'istanza a mano e usi Terraform solo per ricreare da zero.
Per il futuro conviene spostare lo stato su un **backend remoto S3**.

**Ho perso `gym-key.pem` (accesso SSH al server)**
La chiave non è recuperabile. Opzioni:
1. **EC2 Instance Connect** dalla console AWS (accesso browser senza chiave), poi aggiungi
   una nuova chiave pubblica in `~ubuntu/.ssh/authorized_keys`
2. Ricreare l'istanza con una key pair nuova (`terraform taint aws_instance.gym && terraform apply`)
   e rifare la configurazione descritta in `DEPLOY.md` — il database è sul cloud, quindi **non si perde nulla**

**Il deploy automatico fallisce**
Guarda *Actions* su GitHub. Cause tipiche: secrets mancanti/errati, oppure la chiave CI non
più presente in `/opt/gym/.ssh/authorized_keys` sul server.
