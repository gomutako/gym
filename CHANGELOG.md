# Changelog

Tutte le modifiche rilevanti a questo progetto sono documentate qui.
Formato basato su [Keep a Changelog](https://keepachangelog.com/it/1.1.0/),
versionamento [SemVer](https://semver.org/lang/it/).

## [Non rilasciato]

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

[Non rilasciato]: https://github.com/gomutako/gym/compare/1.0.0...develop
[1.0.0]: https://github.com/gomutako/gym/releases/tag/1.0.0
