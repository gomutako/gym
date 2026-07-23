#!/usr/bin/env bash
# =====================================================
# Backup del database Supabase self-host (pg_dump compresso + rotazione).
#   Uso:  ./deploy/backup-db.sh
# Variabili:
#   DB_CONTAINER    nome container Postgres (default supabase-db)
#   BACKUP_DIR      cartella dei backup (default /opt/gym/backups)
#   RETENTION_DAYS  giorni di conservazione (default 14)
# =====================================================
set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
BACKUP_DIR="${BACKUP_DIR:-/opt/gym/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
ts="$(date +%Y%m%d-%H%M%S)"
file="$BACKUP_DIR/gym-db-${ts}.sql.gz"

# Dump dello schema+dati verso stdout, compresso sull'host
docker exec "$DB_CONTAINER" pg_dump -U postgres -d postgres | gzip > "$file"
echo "✅ Backup creato: $file ($(du -h "$file" | cut -f1))"

# Rotazione: elimina i backup più vecchi di RETENTION_DAYS
deleted=$(find "$BACKUP_DIR" -name 'gym-db-*.sql.gz' -mtime +"$RETENTION_DAYS" -print -delete | wc -l)
[ "$deleted" -gt 0 ] && echo "🗑  rimossi $deleted backup più vecchi di ${RETENTION_DAYS} giorni"
exit 0
