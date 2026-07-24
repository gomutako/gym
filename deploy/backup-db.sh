#!/usr/bin/env bash
# =====================================================
# Backup del database (pg_dump compresso + rotazione).
# Punta al DB via connection string, quindi va bene sia per Supabase Cloud
# sia per il DB locale della CLI.
#
#   Cloud:  DATABASE_URL="postgresql://postgres:PWD@db.<ref>.supabase.co:5432/postgres" \
#             ./deploy/backup-db.sh
#           (connection string: Dashboard → Project Settings → Database)
#
# Variabili:
#   DATABASE_URL    connessione al DB (default: DB locale della CLI)
#   BACKUP_DIR      cartella dei backup (default /opt/gym/backups)
#   RETENTION_DAYS  giorni di conservazione (default 14)
#
# Richiede pg_dump (pacchetto postgresql-client).
# Utile soprattutto sul piano free di Supabase, che non include i backup automatici.
# =====================================================
set -euo pipefail

DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
BACKUP_DIR="${BACKUP_DIR:-/opt/gym/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

command -v pg_dump >/dev/null || { echo "❌ pg_dump non trovato: installa postgresql-client"; exit 1; }

mkdir -p "$BACKUP_DIR"
ts="$(date +%Y%m%d-%H%M%S)"
file="$BACKUP_DIR/gym-db-${ts}.sql.gz"

pg_dump "$DATABASE_URL" | gzip > "$file"
echo "✅ Backup creato: $file ($(du -h "$file" | cut -f1))"

# Rotazione: elimina i backup più vecchi di RETENTION_DAYS
deleted=$(find "$BACKUP_DIR" -name 'gym-db-*.sql.gz' -mtime +"$RETENTION_DAYS" -print -delete | wc -l)
[ "$deleted" -gt 0 ] && echo "🗑  rimossi $deleted backup più vecchi di ${RETENTION_DAYS} giorni"
exit 0
