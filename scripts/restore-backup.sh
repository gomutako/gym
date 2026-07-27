#!/usr/bin/env bash
# =====================================================
# Verifica e ripristino di un backup prodotto dal workflow "DB backup".
#
# Gli archivi sono cifrati con GPG (simmetrico, AES-256): senza la passphrase
# non si aprono. È voluto — il repository è pubblico e gli artifact di GitHub
# Actions sono scaricabili da chiunque.
#
#   ./scripts/restore-backup.sh --check    gym-db-<stamp>.sql.gz.gpg
#   ./scripts/restore-backup.sh --restore  gym-db-<stamp>.sql.gz.gpg
#
# --check    decifra in memoria e verifica integrità e contenuto. Non tocca
#            nessun database. È il controllo da fare dopo il PRIMO backup.
# --restore  ripristina nel Supabase LOCALE (sovrascrive i dati di sviluppo,
#            chiede conferma). Non punta mai al cloud di proposito: un
#            ripristino sul database di produzione non deve essere a un flag
#            di distanza.
#
# La passphrase si passa in BACKUP_PASSPHRASE, oppure viene chiesta.
# =====================================================
set -euo pipefail

MODE="${1:-}"
FILE="${2:-}"

if [[ "$MODE" != "--check" && "$MODE" != "--restore" ]] || [[ -z "$FILE" ]]; then
  sed -n '2,20p' "$0" | sed 's/^# \?//'
  exit 1
fi
[[ -f "$FILE" ]] || { echo "❌ File non trovato: $FILE" >&2; exit 1; }
command -v gpg >/dev/null || { echo "❌ gpg non installato" >&2; exit 1; }

if [[ -z "${BACKUP_PASSPHRASE:-}" ]]; then
  read -rsp "Passphrase del backup: " BACKUP_PASSPHRASE
  echo
fi

TMP="$(mktemp -d)"
trap 'find "$TMP" -type f -exec shred -u {} + 2>/dev/null; rm -rf "$TMP"' EXIT

echo "▶ Decifro…"
if ! gpg --batch --quiet --decrypt --passphrase-fd 3 "$FILE" 3<<< "$BACKUP_PASSPHRASE" \
     > "$TMP/dump.sql.gz" 2>"$TMP/gpg.err"; then
  echo "❌ Decifratura fallita (passphrase sbagliata o file corrotto):" >&2
  sed 's/^/   /' "$TMP/gpg.err" >&2
  exit 1
fi

echo "▶ Verifico l'archivio…"
gzip -t "$TMP/dump.sql.gz" || { echo "❌ gzip corrotto" >&2; exit 1; }
size=$(stat -c%s "$TMP/dump.sql.gz")
echo "   compresso: $(du -h "$FILE" | cut -f1) · in chiaro (gz): $((size / 1024)) KB"

missing=0
for t in profiles classes bookings workouts workout_templates exercises workout_sessions subscriptions; do
  if zgrep -q "CREATE TABLE public.$t" "$TMP/dump.sql.gz"; then
    # Conta le righe del SOLO blocco COPY della tabella: dalla riga successiva a
    # `COPY public.<t> ...` fino al terminatore `\.` che chiude il blocco.
    rows=$(zcat "$TMP/dump.sql.gz" | awk -v tbl="public.$t" '
      $0 ~ "^COPY " tbl " " { inblock = 1; next }
      inblock && /^\\\.$/    { inblock = 0 }
      inblock                { n++ }
      END                    { print n + 0 }')
    printf "   ✓ %-20s %s righe\n" "$t" "$rows"
  else
    echo "   ❌ tabella mancante: $t"; missing=1
  fi
done
[[ "$missing" -eq 0 ]] || { echo "❌ Il dump è incompleto." >&2; exit 1; }

# Le regole di sicurezza devono essere DENTRO il backup: ripristinare i dati
# senza policy e trigger produrrebbe un database aperto a chiunque.
echo "▶ Verifico che policy e trigger siano nel dump…"
for obj in "CREATE POLICY" "CREATE TRIGGER" "ROW LEVEL SECURITY"; do
  n=$(zgrep -c "$obj" "$TMP/dump.sql.gz" || true)
  printf "   %s %-24s %s\n" "$([[ "$n" -gt 0 ]] && echo ✓ || echo ❌)" "$obj" "$n"
  [[ "$n" -gt 0 ]] || missing=1
done
[[ "$missing" -eq 0 ]] || { echo "❌ Mancano le regole di sicurezza nel dump." >&2; exit 1; }

if [[ "$MODE" == "--check" ]]; then
  echo "✅ Backup valido e completo. Nessun database è stato toccato."
  exit 0
fi

# ---- ripristino nel Supabase LOCALE ----
CONTAINER=supabase_db_gym
docker inspect "$CONTAINER" >/dev/null 2>&1 \
  || { echo "❌ Container $CONTAINER non attivo: lancia prima 'npm run db:start'" >&2; exit 1; }

echo
echo "⚠️  Sto per SOVRASCRIVERE il database locale ($CONTAINER) con questo backup."
read -rp "   Scrivi 'ripristina' per procedere: " confirm
[[ "$confirm" == "ripristina" ]] || { echo "Annullato."; exit 1; }

echo "▶ Ripristino…"
gunzip -c "$TMP/dump.sql.gz" | docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=0 \
  | tail -5
echo "✅ Ripristino completato. Controlla l'app in locale."
