#!/usr/bin/env bash
# =====================================================
# Applica le migration del repo al progetto Supabase CLOUD.
# La CLI tiene traccia da sé di cosa è già applicato (schema
# supabase_migrations sul DB remoto): rieseguirlo è sicuro.
#
# DUE MODI, in ordine di preferenza:
#
# 1. Connection string esplicita (funziona ANCHE da WSL):
#      export SUPABASE_DB_URL="postgresql://postgres.<ref>:<pwd>@aws-0-<region>.pooler.supabase.com:5432/postgres"
#      ./scripts/db-push.sh
#    Il "Session pooler" del dashboard (Database → Connection string → Session
#    pooler) ha un indirizzo IPv4. Serve perché l'host diretto
#    db.<ref>.supabase.co pubblica SOLO record AAAA (IPv6) e da WSL, che non ha
#    IPv6 globale, `db push` falla con "PgClient: Failed to connect".
#    ⚠️ La password va percent-encoded se contiene caratteri speciali.
#
# 2. Progetto collegato (da macOS/Linux con IPv6 funzionante):
#      npx supabase login
#      npx supabase link --project-ref <REF>
#      ./scripts/db-push.sh
#    Il link sta in supabase/.temp/, che è gitignorato: dopo un clone va rifatto.
#
# In CI questo script non serve: c'è .github/workflows/db-migrate.yml.
#
#   Uso:  ./scripts/db-push.sh [--dry-run]
# =====================================================
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DRY_RUN=""
[ "${1:-}" = "--dry-run" ] && DRY_RUN="--dry-run"

if [ -n "${SUPABASE_DB_URL:-}" ]; then
  TARGET=(--db-url "$SUPABASE_DB_URL")
  echo "▶ Target: connection string esplicita (SUPABASE_DB_URL)"
elif [ -f supabase/.temp/project-ref ] || [ -n "${SUPABASE_PROJECT_REF:-}" ]; then
  TARGET=(--linked)
  echo "▶ Target: progetto collegato ($(cat supabase/.temp/project-ref 2>/dev/null || echo "$SUPABASE_PROJECT_REF"))"
else
  cat <<'EOF'
❌ Nessun target: imposta SUPABASE_DB_URL (Session pooler, IPv4) oppure collega
   il progetto con `npx supabase link --project-ref <REF>`.
   Da WSL usa la prima strada: l'host diretto è raggiungibile solo via IPv6.
EOF
  exit 1
fi

echo "▶ Stato delle migration sul remoto…"
npx supabase migration list "${TARGET[@]}"

if [ -n "$DRY_RUN" ]; then
  echo "▶ Anteprima (nessuna modifica applicata)…"
  npx supabase db push --dry-run "${TARGET[@]}"
  echo "✅ Anteprima completata. Rilancia senza --dry-run per applicare."
  exit 0
fi

echo "▶ Applico le migration mancanti…"
npx supabase db push "${TARGET[@]}"

echo "▶ Stato finale…"
npx supabase migration list "${TARGET[@]}"
echo "✅ Migration allineate sul cloud."
