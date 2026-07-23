#!/usr/bin/env bash
# =====================================================
# Promuove un utente registrato ad 'admin'.
#   Uso:  ./deploy/make-admin.sh email@utente.com
# =====================================================
set -euo pipefail

EMAIL="${1:?Uso: ./deploy/make-admin.sh email@utente.com}"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
  "update public.profiles set role='admin'
   where id = (select id from auth.users where email = '${EMAIL}');"

echo "✅ '${EMAIL}' è ora admin (se l'utente esiste)."
