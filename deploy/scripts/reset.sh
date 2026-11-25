#!/usr/bin/env bash
# Starts over: deletes ALL data (accounts, WhatsApp session, knowledge, settings). The secrets stay.
set -euo pipefail
cd "$(dirname "$0")/.."
read -r -p "Ini MENGHAPUS semua data AutoBot. Ketik 'hapus semua' untuk lanjut: " ok
[ "$ok" = "hapus semua" ] || { echo "dibatalkan"; exit 1; }
docker compose down --volumes
echo "OK data dihapus. Jalankan 'docker compose up -d' lalu ambil token setup dari log web."
