#!/usr/bin/env bash
# =====================================================
# Promuove un utente registrato ad 'admin'.
# Funziona sia sul cloud sia in locale, tramite connection string.
#
#   Cloud:  DATABASE_URL="postgresql://postgres:PWD@db.<ref>.supabase.co:5432/postgres" \
#             ./deploy/make-admin.sh email@utente.com
#           (la trovi in Dashboard → Project Settings → Database → Connection string)
#
#   Locale: ./deploy/make-admin.sh email@utente.com
#           (usa il DB della Supabase CLI su 127.0.0.1:54322)
#
# Richiede psql (pacchetto postgresql-client).
# In alternativa puoi lanciare la stessa UPDATE dal SQL Editor del dashboard.
# =====================================================
set -euo pipefail

EMAIL="${1:?Uso: ./deploy/make-admin.sh email@utente.com}"
DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

command -v psql >/dev/null || { echo "❌ psql non trovato: installa postgresql-client"; exit 1; }

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "update public.profiles set role='admin'
   where id = (select id from auth.users where email = '${EMAIL}');"

echo "✅ '${EMAIL}' è ora admin (se l'utente esiste)."
