#!/usr/bin/env bash
# =====================================================
# Reset completo del database LOCALE + seed dati demo.
#   1. `supabase db reset`  -> ricrea il DB riapplicando tutte le migration
#   2. `node scripts/seed.mjs` -> utenze, corsi, catalogo 50 esercizi, scheda demo
#
# Richiede Docker attivo (Supabase locale). Uso:  ./scripts/reset-db.sh
# In produzione NON usare: le migration remote si applicano con `npm run db:push`.
# =====================================================
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "▶ 1/2 — Reset del database locale (riapplico tutte le migration)…"
npx supabase db reset

echo "▶ 2/2 — Seeding dati demo…"
node scripts/seed.mjs

echo "✅ Database locale resettato e popolato."
