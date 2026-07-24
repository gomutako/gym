#!/usr/bin/env bash
# =====================================================
# Applica le migration del progetto al progetto Supabase CLOUD.
# Usa la Supabase CLI, che tiene traccia da sola delle migration già applicate
# (schema supabase_migrations sul DB remoto): eseguirlo più volte è sicuro.
#
# Prerequisiti (una tantum, dalla tua macchina):
#   npx supabase login                       # apre il browser, salva il token
#   npx supabase link --project-ref <REF>    # REF = dashboard → Project Settings → General
#
#   Uso:  ./deploy/db-push.sh
# =====================================================
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -f supabase/.temp/project-ref ] && [ -z "${SUPABASE_PROJECT_REF:-}" ]; then
  cat <<'EOF'
❌ Progetto non collegato.
   Esegui prima:
     npx supabase login
     npx supabase link --project-ref <PROJECT_REF>
EOF
  exit 1
fi

echo "▶ Anteprima delle migration da applicare…"
npx supabase migration list

echo "▶ Applico le migration al progetto remoto…"
npx supabase db push

echo "✅ Migration allineate sul cloud (tabelle, RLS, bucket exercise-images, policy Storage)."
