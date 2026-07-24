#!/usr/bin/env bash
# =====================================================
# user-data (cloud-init): eseguito UNA VOLTA come root al primo avvio dell'EC2.
# L'istanza ospita SOLO l'app (backend Fastify + Caddy che serve la SPA):
# il database è Supabase Cloud, quindi niente Docker né stack Supabase qui.
# La configurazione app-specifica (chiavi Supabase, domini) resta manuale: DEPLOY.md.
# __REPO_URL__ viene sostituito dallo script di provisioning.
# =====================================================
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive

# --- Swap 2G: dà respiro a npm install / vite build su istanze da 1 GB ---
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile
  mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

apt-get update && apt-get -y upgrade

# --- Node 22 + git + client Postgres (per backup/manutenzione del DB cloud) ---
# Node 22 è il minimo richiesto da @supabase/supabase-js (usa la WebSocket nativa).
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs git postgresql-client

# --- Caddy ---
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy

# --- Utente di servizio + repo + sudoers per il restart ---
id gym &>/dev/null || useradd -r -m -d /opt/gym gym

# useradd -m popola /opt/gym con i file skeleton, quindi `git clone` fallirebbe
# ("destination path already exists and is not an empty directory"):
# si inizializza il repo in-place con init + fetch.
if [ ! -d /opt/gym/.git ]; then
  git config --global --add safe.directory /opt/gym
  git -C /opt/gym init -q
  git -C /opt/gym remote add origin __REPO_URL__
  git -C /opt/gym fetch --depth 1 origin master
  git -C /opt/gym checkout -B master origin/master
fi

chown -R gym:gym /opt/gym
# 755 (non 750): Caddy gira come utente 'caddy' e deve poter leggere frontend/dist
chmod 755 /opt/gym
echo 'gym ALL=(ALL) NOPASSWD: /bin/systemctl restart gym-backend' > /etc/sudoers.d/gym-deploy

touch /opt/gym/.provisioned
echo "cloud-init completato"
