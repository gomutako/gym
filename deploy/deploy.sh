#!/usr/bin/env bash
# =====================================================
# Deploy on-server: aggiorna il codice, ricostruisce il frontend,
# riavvia il backend. Eseguibile a mano (SSH) o richiamato dalla CI.
#   Uso:  ./deploy/deploy.sh
# Richiede: repo in /opt/gym, .env di produzione già presenti,
#           utente con sudo NOPASSWD per "systemctl restart gym-backend".
# =====================================================
set -euo pipefail

# Vai alla root del repo (cartella genitore di questo script)
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

BRANCH="${DEPLOY_BRANCH:-main}"

echo "▶ Aggiorno il codice (origin/$BRANCH)…"
git fetch --prune origin
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "▶ Installo le dipendenze…"
npm install --no-audit --no-fund

echo "▶ Build del frontend (usa frontend/.env.production)…"
npm run build --workspace frontend

echo "▶ Riavvio il backend…"
sudo systemctl restart gym-backend

echo "✅ Deploy completato ($(git rev-parse --short HEAD))."

# NB: le migration del DB NON vengono applicate qui (operazione potenzialmente
# distruttiva). Applicale a mano quando aggiungi nuove migration — vedi DEPLOY.md §4.
