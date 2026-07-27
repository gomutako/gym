# Deploy — Cloudflare Pages + Supabase + Resend

Pallade non ha un server applicativo. Tre servizi gestiti, tutti sul piano gratuito:

```text
pallade.it                → Cloudflare Pages          SPA statica + .well-known/
<ref>.supabase.co         → Supabase Cloud            Postgres + RLS, Auth, Storage,
                                                       Edge Function admin-users
send.pallade.it           → Resend                    SMTP di Supabase Auth
GitHub Actions            → DB migrate, DB backup     migrazioni e pg_dump schedulato
app iOS (Capacitor)       → bundle statico            parla diretto a Supabase
```

Non c'è nulla da amministrare via SSH: nessuna istanza, nessun reverse proxy, nessun
processo da riavviare. Il codice va in produzione con un `git push`; le migrazioni con un
workflow che si lancia a mano.

> **Storia**: fino al 2026-07-27 il progetto girava su EC2 con Caddy e un backend Fastify
> (`backend/`, `deploy/`, `terraform/`, ora eliminati). Il perché e il come della migrazione
> stanno in `docs/superpowers/plans/2026-07-27-migrazione-cloudflare-supabase.md`.

---

## 1. Supabase Cloud

Progetto: ref `nayiujdfvevccoluqwic`, region `eu-west-1`, Postgres 17.

**Project Settings → API** — da qui si prendono:

- **Project URL** → `VITE_SUPABASE_URL`
- **anon / publishable key** → `VITE_SUPABASE_ANON_KEY`. È **pubblica per costruzione**:
  finisce nel bundle. Ciò che protegge i dati è la RLS, non la segretezza di questa chiave.
- **service_role key** → **mai** nel frontend. La usano solo il seed, gli script di
  manutenzione (da `.env.production` alla root, gitignorato) e la Edge Function, dove
  Supabase la inietta da sé.

**Authentication → URL Configuration**

- `Site URL` = `https://pallade.it` — non è cosmetico: è la base con cui i template email
  costruiscono i link. Puntarla a un host che non serve l'app rompe il reset password.
- **Redirect URLs**: `https://pallade.it/**` **e** `capacitor://localhost/**`. Senza il
  secondo, i redirect dentro l'app iOS vengono rifiutati.

**Authentication → Rate Limits**: alzare il limite di invio email. È indipendente da
Resend: al valore di default i reset password vengono throttled anche con un SMTP capace.

### Schema del database

Le migrazioni in `supabase/migrations/` sono la fonte di verità. **Non si applicano col
deploy del codice**: vanno applicate prima, con uno di questi modi.

```bash
# 1. Workflow GitHub "DB migrate" (consigliato: non dipende dalla rete locale)
#    Actions → DB migrate → Run workflow, prima con dry_run=true

# 2. Da locale, con la connection string del Session pooler
export SUPABASE_DB_URL="postgresql://postgres.<ref>:<pwd>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres"
npm run db:push:dry
npm run db:push

# 3. SQL Editor del dashboard, solo come ripiego d'emergenza:
#    incollare l'SQL e poi registrare la versione a mano
#    insert into supabase_migrations.schema_migrations (version) values ('<timestamp>');
```

⚠️ **Da WSL l'host diretto `db.<ref>.supabase.co` non è raggiungibile**: pubblica solo
record AAAA (IPv6). Serve il **Session pooler**, che ha IPv4.

⚠️ **Ordine obbligato: migrazione prima del codice.** Al contrario il sintomo è silenzioso —
un client vecchio non conosce la colonna nuova, il dato non viene salvato e nessuno segnala
un errore.

### Edge Function

```bash
npx supabase functions deploy admin-users
```

È l'unico codice con privilegi di servizio: cambia l'email di un utente (che vive in
`auth.users`, fuori dalla portata della anon key). Verifica dopo il deploy che la whitelist
CORS includa l'origine dell'app iOS:

```bash
curl -sD - -o /dev/null -X OPTIONS \
  https://nayiujdfvevccoluqwic.supabase.co/functions/v1/admin-users \
  -H 'Origin: capacitor://localhost' | grep -i access-control-allow-origin
```

Se l'header manca, l'origine non è ammessa: si aggiusta col secret `ALLOWED_ORIGINS`
(lista separata da virgole) senza ridistribuire la funzione.

---

## 2. Cloudflare Pages

Progetto Pages collegato al repo GitHub, branch `master`:

| Impostazione | Valore |
| --- | --- |
| Build command | `npm install && npm run build --workspace frontend` |
| Build output directory | `frontend/dist` |
| Node version | `22` |
| Variabili | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |

Le variabili `VITE_*_SIM` **non** vanno su Pages: servono solo alla build locale per il
simulatore iOS.

Custom domain `pallade.it` (+ `www` in redirect). Il certificato lo gestisce Cloudflare.

⚠️ **Nessun record DNS di `pallade.it` deve puntare altrove.** Se punta a un'origine che non
sa servire TLS per quel nome, Cloudflare risponde **525** (handshake fallito). Un 522/523
significherebbe invece origine irraggiungibile.

Due file in `frontend/public/` fanno funzionare cose che altrimenti si rompono in silenzio:

- **`_redirects`** — `/*  /index.html  200`. Senza, ogni deep link risponde 404: Pages cerca
  un file con quel path, mentre le rotte le risolve il router Vue. Riguarda anche il link
  del reset password.
- **`_headers`** — forza `application/json` su `.well-known/apple-app-site-association` (non
  ha estensione, altrimenti verrebbe servito come octet-stream e iOS lo ignorerebbe), e
  impedisce la cache di `sw.js`/`index.html`: il plugin PWA è in `registerType: autoUpdate`,
  e un service worker servito da cache tiene l'utente su una versione vecchia anche dopo un
  deploy riuscito.

---

## 3. Resend (posta di Supabase Auth)

1. Verifica del dominio su **`send.pallade.it`**, non su `pallade.it`: così gli MX del
   dominio radice restano liberi per eventuali caselle vere.
2. Record **SPF** e **DKIM** indicati da Resend, più un **DMARC** su `pallade.it`.
3. Supabase → **Project Settings → Authentication → SMTP Settings** → *Enable custom SMTP*:
   host `smtp.resend.com`, porta `587`, username `resend`, password = API key,
   sender `noreply@pallade.it`.
4. **Authentication → Email Templates**: incollare i template italiani da
   `supabase/templates/` (in locale li carica `config.toml`, in produzione no):
   - *Reset Password* → [`recovery.html`](supabase/templates/recovery.html)
   - *Confirm signup* → [`confirmation.html`](supabase/templates/confirmation.html)
   - *Change email address* → [`email_change.html`](supabase/templates/email_change.html)

⚠️ Il template di reset costruisce il link con `{{ .SiteURL }}` e `{{ .TokenHash }}`, **non**
con `{{ .ConfirmationURL }}`. Quest'ultimo rimbalza sul `redirectTo` del client, che dentro
l'app iOS è `capacitor://localhost`: uno schema che nessun client di posta su iOS apre,
lasciando l'utente bloccato. La pagina `/reset-password` scambia il token con `verifyOtp()`.

---

## 4. Backup

Il piano **Free di Supabase non include backup automatici**. Ci pensa il workflow
**DB backup** (`.github/workflows/db-backup.yml`): ogni giorno alle 03:17 UTC fa
`pg_dump` → `gzip` → **cifratura GPG AES-256**, verifica il risultato **decifrandolo** (un
dump che non si riapre non è un backup, e così il test copre anche la passphrase) e lo carica
come artifact con 30 giorni di conservazione.

Secret richiesti: `SUPABASE_DB_URL` (lo stesso di *DB migrate*) e `BACKUP_PASSPHRASE`.

🔒 **La cifratura non è opzionale, ed è il motivo per cui il job si rifiuta di partire senza
passphrase.** Questo repository è **pubblico**, e sui repo pubblici gli artifact di Actions
sono scaricabili da chiunque veda il repo. Il dump contiene i dati personali dei clienti
(nome, email, telefono, data di nascita, peso, note del trainer): caricarlo in chiaro
equivarrebbe a pubblicarli. Il workflow controlla anche che la passphrase sia lunga almeno
20 caratteri, perché altrimenti la cifratura è decorativa.

⚠️ Conserva `BACKUP_PASSPHRASE` **anche fuori da GitHub** (password manager): senza, gli
archivi sono irrecuperabili.

Ripristino su un'istanza locale:

```bash
gpg --decrypt --batch --passphrase '<BACKUP_PASSPHRASE>' gym-db-<stamp>.sql.gz.gpg \
  | gunzip \
  | docker exec -i supabase_db_gym psql -U postgres -d postgres
```

---

## 5. Checklist di rilascio

```bash
# 1. migrazioni PRIMA del codice
#    Actions → DB migrate (dry_run=true, poi false)

# 2. Edge Function, se è cambiata
npx supabase functions deploy admin-users

# 3. codice: il push fa partire la build di Pages
git push origin master

# 4. app iOS (serve un Mac)
npm run build && npx cap sync ios
xcodebuild -workspace frontend/ios/App/App.xcworkspace -scheme App \
  -configuration Debug -destination 'id=<UDID>' -allowProvisioningUpdates build
```

Verifiche dopo il rilascio:

- `https://pallade.it` carica l'app, e un deep link diretto (es. `/allenamento`) **non** dà 404
- login, e una lettura che passa dalla RLS (catalogo esercizi)
- reset password: l'email arriva da `noreply@pallade.it` e il link riporta all'app
- dalla vista admin: cambio email di un utente (esercita la Edge Function)
- creare una scheda **come trainer**, non come admin: è il caso in cui `trainer_id` deve
  combaciare con `auth.uid()`, e un admin non lo verificherebbe

---

## 6. Prima di aprire al mondo

- **Supabase Pro ($25/mese)**: il piano Free non fa backup automatici e **mette in pausa il
  progetto dopo una settimana di inattività**. Con clienti veri è il minimo. In regalo
  arrivano le image transformations, e il custom domain diventa un add-on da $10.
- **Cancellazione account in-app**: l'App Store la **richiede** per ogni app che permette di
  registrarsi (linea guida 5.1.1(v)). Serve una Edge Function con `auth.admin.deleteUser`
  più la pulizia dei dati collegati.
- **Privacy policy e termini** su `pallade.it`: l'URL della privacy è obbligatorio in App
  Store Connect.
- **HealthKit**: usage description esplicite in `Info.plist`, una delle cause di rifiuto più
  comuni.
