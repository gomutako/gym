# Deploy su EC2 + Supabase Cloud

Guida per pubblicare Gym Manager con **EC2 free tier** (solo app) e **Supabase Cloud free tier**
(database, Auth, Storage). Backend Fastify, frontend statico (PWA), HTTPS automatico via Caddy.

```
Internet ──HTTPS──▶ Caddy ── app.tuodominio.com ─▶ dist/ (SPA)  +  /api ─▶ Fastify :3000
                                     │
   browser + backend ────HTTPS───────┴────────────▶ https://<ref>.supabase.co  (Supabase Cloud)
```

**Perché così:** l'istanza ospita solo backend e file statici, quindi basta una `t3.micro`
(free tier AWS). Il DB pesante sta su Supabase Cloud, anch'esso free tier.

> **Ambienti:** in **locale** si usa Supabase via CLI/Docker (`npm run db:start`),
> in **produzione** Supabase Cloud. Cambiano solo i file `.env` — il codice è identico.

## 0. Dimensionamento

| Istanza | RAM | Note |
|---|---|---|
| **t3.micro** | 1 GB | ✅ free tier AWS (750 h/mese per 12 mesi), con 2 GB di swap |
| t3.small | 2 GB | build più veloci, ma fuori free tier |

Disco 10 GB gp3 (il free tier include 30 GB). Security group: **22, 80, 443**.

**Hostname senza dominio proprio.** Let's Encrypt non emette certificati per IP nudi, e
l'app richiede HTTPS (il service worker della PWA e `crypto.randomUUID()` usato per gli
upload funzionano solo in *secure context*). Soluzione senza acquistare nulla: **sslip.io**,
che risolve `<IP-con-trattini>.sslip.io` al tuo IP — Caddy ottiene così un certificato valido.

```
Elastic IP 52.30.1.2  ->  https://52-30-1-2.sslip.io
```
Nessun record DNS da creare. Con un dominio vero, sostituisci l'hostname nel `Caddyfile`
e nei due `.env`, e crea un record A verso l'IP.

## 1. Progetto Supabase Cloud

1. Crea un progetto su [supabase.com](https://supabase.com) (piano **Free**), scegli una region vicina.
2. **Project Settings → API**: prendi nota di
   - **Project URL** → `https://<ref>.supabase.co`
   - **anon public** key → frontend e backend
   - **service_role** key → **solo backend** (bypassa la RLS, mai nel browser)
3. **Authentication → Providers → Email**: disattiva *Confirm email*
   (l'app fa login subito dopo la registrazione; in alternativa configura l'SMTP).
4. **Authentication → URL Configuration**: `Site URL` = `https://app.tuodominio.com`.

### Schema del database
Le migration in `supabase/migrations/` creano tabelle, RLS, il bucket `exercise-images`
e le policy Storage. Applicale al progetto remoto con la Supabase CLI:

```bash
npx supabase login                        # una tantum
npx supabase link --project-ref <REF>     # REF: Project Settings → General
./deploy/db-push.sh                       # esegue supabase db push
```
La CLI tiene traccia delle migration già applicate: rieseguirlo è sicuro.

## 2. Istanza EC2

Con Terraform (consigliato) oppure con lo script AWS CLI:

```bash
# Terraform
cd terraform && cp terraform.tfvars.example terraform.tfvars   # key_name, repo_url
terraform init && terraform apply

# ...oppure AWS CLI
KEY_NAME=la-mia-keypair REPO_URL=https://github.com/tuo-utente/gym.git \
  ./deploy/provision-ec2.sh
```

Entrambi usano `deploy/cloud-init.sh`, che al primo avvio installa **swap, Node 20, git,
postgresql-client e Caddy**, crea l'utente `gym` e clona il repo in `/opt/gym` (2-3 min).
Niente Docker: sul server non gira alcun database.

<details>
<summary>Installazione manuale (se non usi il provisioning automatico)</summary>

```bash
sudo apt update && sudo apt -y upgrade
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt -y install nodejs git postgresql-client

sudo apt -y install debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt -y install caddy

sudo useradd -r -m -d /opt/gym gym
sudo git clone <URL-del-repo> /opt/gym && sudo chown -R gym:gym /opt/gym
```
</details>

## 3. App: backend + frontend

```bash
cd /opt/gym
npm install

# Backend — chiavi dal dashboard Supabase Cloud
cp backend/.env.production.example backend/.env
#   SUPABASE_URL=https://<ref>.supabase.co
#   SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY / CORS_ORIGIN
sudo cp deploy/gym-backend.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now gym-backend
systemctl status gym-backend      # deve essere "active (running)"

# Frontend (build di produzione)
cp frontend/.env.production.example frontend/.env.production
#   VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / VITE_API_BASE_URL
npm run build --workspace frontend    # genera frontend/dist (con PWA)
```

## 4. Caddy (HTTPS automatico)

```bash
sudo cp /opt/gym/deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile        # metti il tuo dominio reale
sudo systemctl reload caddy
```
Caddy ottiene i certificati Let's Encrypt da solo al primo accesso HTTPS.

## 5. Primo amministratore

Registrati dall'app (diventi `member`), poi promuoviti ad admin — dal **SQL Editor**
del dashboard oppure via script:
```bash
DATABASE_URL="postgresql://postgres:PWD@db.<ref>.supabase.co:5432/postgres" \
  ./deploy/make-admin.sh tua@email.com
```

## 6. Verifiche
- `https://app.tuodominio.com` carica l'app e su mobile compare **"Aggiungi a Home"** (PWA)
- Login/registrazione funzionano (Auth cloud)
- Le immagini degli esercizi si caricano (Storage/bucket)
- `https://app.tuodominio.com/api/health` → `{"status":"ok"}`

## Aggiornamenti & manutenzione
- **Aggiornare a mano:** `cd /opt/gym && ./deploy/deploy.sh`
- **Nuove migration:** `./deploy/db-push.sh` dalla tua macchina (il deploy dell'app NON le esegue)
- **Backup DB:** il piano Free di Supabase non include backup automatici, quindi conviene farli:
  ```bash
  # manuale
  DATABASE_URL="postgresql://postgres:PWD@db.<ref>.supabase.co:5432/postgres" ./deploy/backup-db.sh

  # automatico giornaliero sull'EC2
  echo 'DATABASE_URL=postgresql://postgres:PWD@db.<ref>.supabase.co:5432/postgres' \
    | sudo tee /etc/gym-backup.env && sudo chmod 600 /etc/gym-backup.env
  sudo cp /opt/gym/deploy/gym-backup.{service,timer} /etc/systemd/system/
  sudo systemctl daemon-reload && sudo systemctl enable --now gym-backup.timer
  systemctl list-timers gym-backup.timer
  ```
- **Log backend:** `journalctl -u gym-backend -f`

> ⚠️ **Free tier Supabase:** i progetti inattivi per ~1 settimana vengono messi in pausa
> (si riattivano dal dashboard). Tienilo presente per ambienti dimostrativi.

## 7. Deploy automatico (opzionale)

Sono inclusi:
- `deploy/deploy.sh` — script on-server: `git reset --hard`, `npm install`, build frontend, restart backend
- `.github/workflows/deploy.yml` — GitHub Action: builda (gate) e poi esegue lo script via SSH ad ogni push su `master` (produzione, git flow)

Prerequisito sul server (già impostato dal cloud-init) perché il restart avvenga senza password:
```bash
echo 'gym ALL=(ALL) NOPASSWD: /bin/systemctl restart gym-backend' | sudo tee /etc/sudoers.d/gym-deploy
```

Chiave SSH per la CI (esegui in locale, aggiungi la pubblica al server):
```bash
ssh-keygen -t ed25519 -f deploy_key -N ""            # crea deploy_key / deploy_key.pub
ssh-copy-id -i deploy_key.pub gym@IP_DEL_SERVER      # o incolla in ~gym/.ssh/authorized_keys
```

Su GitHub → **Settings → Secrets and variables → Actions**, crea:
| Secret | Valore |
|---|---|
| `DEPLOY_HOST` | IP pubblico o dominio dell'EC2 |
| `DEPLOY_USER` | `gym` |
| `DEPLOY_SSH_KEY` | contenuto di `deploy_key` (chiave **privata**) |
| `DEPLOY_PORT` | (opzionale) porta SSH se diversa da 22 |

Da qui in poi ogni `git push` su `master` (nel git flow: una release/hotfix)
builda e rilascia in automatico — oppure lancialo a mano da **Actions → Deploy → Run workflow**.
