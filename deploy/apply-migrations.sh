#!/usr/bin/env bash
# =====================================================
# Applica le migration del progetto al Postgres di Supabase self-host.
# Idempotente: registra le migration già applicate in public._gym_migrations
# e applica solo quelle NUOVE, ciascuna in una singola transazione.
#   Uso:  ./deploy/apply-migrations.sh
#   Override nome container:  DB_CONTAINER=supabase_db_xxx ./deploy/apply-migrations.sh
# =====================================================
set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$"; then
  echo "❌ Container '$DB_CONTAINER' non trovato. Container attivi:"
  docker ps --format '  {{.Names}}'
  echo "Imposta DB_CONTAINER col nome giusto e riprova."
  exit 1
fi

psql() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres "$@"; }

# Tabella di tracciamento
psql -v ON_ERROR_STOP=1 -q -c \
  "create table if not exists public._gym_migrations (filename text primary key, applied_at timestamptz not null default now());" >/dev/null

applied=0
for f in "$ROOT"/supabase/migrations/*.sql; do
  name="$(basename "$f")"
  exists=$(psql -tAc "select 1 from public._gym_migrations where filename='${name}';")
  if [ "$exists" = "1" ]; then
    echo "· salto ${name} (già applicata)"
    continue
  fi
  echo "▶ applico ${name}"
  psql -v ON_ERROR_STOP=1 --single-transaction < "$f"
  psql -v ON_ERROR_STOP=1 -q -c "insert into public._gym_migrations(filename) values ('${name}');" >/dev/null
  applied=$((applied + 1))
done

echo "✅ Fatto. Nuove migration applicate: ${applied}."
