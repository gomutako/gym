# Deploy self-hosted su EC2

Guida per pubblicare Gym Manager su una singola istanza EC2 con **Supabase self-hosted**,
backend Fastify, frontend statico (PWA) e HTTPS automatico via Caddy.

```
Internet ──HTTPS──▶ Caddy ─┬─ app.tuodominio.com   ─▶ dist/ (SPA)  +  /api ─▶ Fastify :3000
                           └─ supabase.tuodominio.com ─▶ Kong :8000 ─▶ stack Supabase (Docker)
```

## 0. Dimensionamento istanza

Lo stack Supabase (Postgres, Auth, PostgREST, Storage, Kong, ecc.) è pesante:

| Istanza | RAM | Note |
|---|---|---|
| t3.micro | 1 GB | ❌ insufficiente |
| t4g.small | 2 GB | ⚠️ ok solo con **swap** (passo 2) e stack essenziale |
| **t4g.medium** | 4 GB | ✅ consigliata: stack completo senza pensieri |

`t4g` = ARM (Graviton), più economica. Disco: **almeno 20 GB** (gp3).
Security group: apri **22 (SSH), 80, 443**. DNS: due record **A**
(`app` e `supabase`) verso l'IP pubblico (Elastic IP consigliato).

## 1. Pacchetti base (Ubuntu 24.04)

```bash
sudo apt update && sudo apt -y upgrade
# Docker + compose
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # poi ri-login
# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt -y install nodejs git
# Caddy
sudo apt -y install debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt -y install caddy
```

## 2. Swap (obbligatorio su 2 GB, utile sempre)

```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 3. Supabase self-hosted

```bash
git clone --depth 1 https://github.com/supabase/supabase
cd supabase/docker
cp .env.example .env
```

Nel file `.env` imposta **valori sicuri** (NON i default demo):
- `POSTGRES_PASSWORD` — password forte
- `JWT_SECRET` — stringa random ≥ 40 caratteri
- `ANON_KEY` e `SERVICE_ROLE_KEY` — generali coerenti col `JWT_SECRET`
  con il generatore ufficiale: https://supabase.com/docs/guides/self-hosting/docker#generate-api-keys
- `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` — accesso a Studio
- `SITE_URL=https://app.tuodominio.com`
- `API_EXTERNAL_URL=https://supabase.tuodominio.com`
- `SUPABASE_PUBLIC_URL=https://supabase.tuodominio.com`
- **Auth senza conferma email** (per mantenere il flusso attuale di registrazione):
  `ENABLE_EMAIL_AUTOCONFIRM=true` (in alternativa configura SMTP e lascia la conferma attiva)

Avvia:
```bash
docker compose up -d
docker compose ps   # tutti "healthy"
```

> **Budget 2 GB:** dopo il primo avvio puoi fermare i servizi non usati dall'app
> (`realtime`, `imgproxy`, `functions`) con `docker compose stop realtime imgproxy functions`.
> L'app NON li usa (niente realtime, niente trasformazioni immagini, niente edge functions).
> Su 4 GB lascia tutto attivo.

## 4. Schema del database (le nostre migration)

Le migration in `supabase/migrations/` del progetto creano tabelle, RLS, il bucket
`exercise-images` e le policy Storage. Applicale in ordine al Postgres del self-host:

```bash
# dalla cartella del PROGETTO gym, con il container db in ascolto su 5432
for f in supabase/migrations/*.sql; do
  docker exec -i supabase-db psql -U postgres -d postgres < "$f"
done
```
(Il nome container potrebbe essere `supabase-db` o `supabase_db_*`: verifica con `docker ps`.)

## 5. App: backend + frontend

```bash
sudo useradd -r -m -d /opt/gym gym      # utente di servizio
sudo git clone <URL-del-tuo-repo> /opt/gym && sudo chown -R gym:gym /opt/gym
cd /opt/gym
npm install

# Backend
cp backend/.env.production.example backend/.env
#   -> inserisci ANON_KEY / SERVICE_ROLE_KEY del self-host, CORS_ORIGIN
sudo cp deploy/gym-backend.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now gym-backend
systemctl status gym-backend      # deve essere "active (running)"

# Frontend (build di produzione)
cp frontend/.env.production.example frontend/.env.production
#   -> VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_BASE_URL
npm run build --workspace frontend    # genera frontend/dist (con PWA)
```

## 6. Caddy (HTTPS automatico)

```bash
sudo cp /opt/gym/deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile        # metti i tuoi domini reali
sudo systemctl reload caddy
```
Caddy ottiene i certificati Let's Encrypt da solo al primo accesso HTTPS.

## 7. Primo amministratore

Registrati dall'app (diventi `member`), poi promuoviti ad admin:
```bash
docker exec -i supabase-db psql -U postgres -d postgres \
  -c "update public.profiles set role='admin' where id = (select id from auth.users where email='tua@email.com');"
```

## 8. Verifiche
- `https://app.tuodominio.com` carica l'app e su mobile compare **"Aggiungi a Home"** (PWA)
- Login/registrazione funzionano (Auth)
- Le immagini degli esercizi si caricano (Storage/bucket)
- `https://app.tuodominio.com/api/health` → `{"status":"ok"}`

## Aggiornamenti & manutenzione
- **Aggiornare a mano:** `cd /opt/gym && ./deploy/deploy.sh`
- **Nuove migration:** applicale con lo stesso `for` del passo 4 (lo script NON le esegue)
- **Backup DB:** `docker exec supabase-db pg_dump -U postgres postgres > backup_$(date +%F).sql` (schedula in cron)
- **Log backend:** `journalctl -u gym-backend -f`

## 9. Deploy automatico (opzionale)

Sono inclusi:
- `deploy/deploy.sh` — script on-server: `git reset --hard`, `npm install`, build frontend, restart backend
- `.github/workflows/deploy.yml` — GitHub Action: builda (gate) e poi esegue lo script via SSH ad ogni push su `main`

Prerequisiti sul server perché lo script/CI riavvii il backend senza password:
```bash
# consenti all'utente di deploy il solo restart del servizio senza sudo password
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

Da qui in poi ogni `git push` su `main` builda e rilascia in automatico
(oppure lancialo a mano da **Actions → Deploy → Run workflow**).
