#!/usr/bin/env bash
# Docker: deletes the owner account only (username, password, authenticator, recovery codes, sessions).
# The WhatsApp session, knowledge, settings and conversations in the worker stay. Then (re)starts web for a new setup token.
# For local mode (npm run dev) use: npm run reset-account
set -euo pipefail
cd "$(dirname "$0")/.."
project="${COMPOSE_PROJECT_NAME:-autobot}"
if ! docker volume inspect "${project}_authdata" >/dev/null 2>&1; then
  echo "Belum ada data AutoBot di Docker (volume ${project}_authdata tidak ada)."
  echo "Bila Anda memakai mode lokal (npm run dev), jalankan: npm run reset-account"
  exit 1
fi
read -r -p "Ini MENGHAPUS akun pemilik. Data bot tetap. Ketik 'reset akun' untuk lanjut: " ok
[ "$ok" = "reset akun" ] || { echo "dibatalkan"; exit 1; }
if [ -n "$(docker compose ps --status running -q web 2>/dev/null)" ]; then
  docker compose exec -T web node apps/web/cli.js reset-account --yes
  docker compose restart web
else
  # web is stopped: run the command in a one-off container on the same volume, then start the stack
  docker compose run --rm --no-deps -T web node apps/web/cli.js reset-account --yes
  docker compose up -d
fi
echo "Ambil token setup baru: npm run docker:logs   (cari kotak 'Token setup')"
