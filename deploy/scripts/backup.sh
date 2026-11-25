#!/usr/bin/env bash
# Consistent backup of both databases and the WhatsApp session, while the bot keeps running.
# The archive holds the WhatsApp session and customer data: encrypt it (age) and keep it away from the secrets.
#   OUT_DIR=/path AGE_RECIPIENT=age1... ./backup.sh        (encrypted)
#   OUT_DIR=/path ALLOW_PLAINTEXT_BACKUP=1 ./backup.sh     (not encrypted: chmod 600, local testing only)
set -euo pipefail
cd "$(dirname "$0")/.."
OUT_DIR="${OUT_DIR:?OUT_DIR: folder tujuan, di luar volume}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT_DIR"

docker compose exec -T worker node dist/cli.js backup /tmp/worker-backup >/dev/null
docker compose exec -T web node apps/web/cli.js backup /tmp/web-backup >/dev/null
# (docker cp cannot read the tmpfs /tmp, so the files are streamed out as tar)
mkdir -p "$TMP/worker" "$TMP/web"
docker compose exec -T worker tar -C /tmp/worker-backup -cf - . | tar -C "$TMP/worker" -xf -
docker compose exec -T web tar -C /tmp/web-backup -cf - . | tar -C "$TMP/web" -xf -
docker compose exec -T worker rm -rf /tmp/worker-backup
docker compose exec -T web rm -rf /tmp/web-backup

if [ -n "${AGE_RECIPIENT:-}" ]; then
  FILE="$OUT_DIR/autobot-$STAMP.tar.age"
  tar -C "$TMP" -cf - . | age -r "$AGE_RECIPIENT" > "$FILE"
elif [ "${ALLOW_PLAINTEXT_BACKUP:-}" = "1" ]; then
  FILE="$OUT_DIR/autobot-$STAMP.tar"
  tar -C "$TMP" -cf "$FILE" .
  echo "PERINGATAN: cadangan tidak dienkripsi." >&2
else
  echo "Set AGE_RECIPIENT (kunci publik age) atau ALLOW_PLAINTEXT_BACKUP=1." >&2; exit 1
fi
chmod 600 "$FILE"
find "$OUT_DIR" -name 'autobot-*.tar*' -mtime +14 -delete
echo "OK $FILE"
