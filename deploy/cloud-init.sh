#!/usr/bin/env bash
# =====================================================
# user-data (cloud-init): eseguito UNA VOLTA come root al primo avvio dell'EC2.
# Prepara il sistema base: swap, Docker, Node, Caddy, utente di servizio, repo.
# La configurazione app-specifica (chiavi Supabase, domini) resta manuale: DEPLOY.md.
# __REPO_URL__ viene sostituito dallo script di provisioning.
# =====================================================
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive

# --- Swap 4G (sicurezza su istanze piccole) ---
if [ ! -f /swapfile ]; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile
  mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

apt-get update && apt-get -y upgrade

# --- Docker ---
curl -fsSL https://get.docker.com | sh

# --- Node 20 LTS ---
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git

# --- Caddy ---
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy

# --- Utente di servizio + repo + sudoers per il restart ---
id gym &>/dev/null || useradd -r -m -d /opt/gym gym
usermod -aG docker gym
git clone --depth 1 __REPO_URL__ /opt/gym || true
chown -R gym:gym /opt/gym
echo 'gym ALL=(ALL) NOPASSWD: /bin/systemctl restart gym-backend' > /etc/sudoers.d/gym-deploy

touch /opt/gym/.provisioned
echo "cloud-init completato"
