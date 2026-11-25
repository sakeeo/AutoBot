#!/usr/bin/env bash
# Makes the three secrets once. Never overwrites: replacing ENGINE_SECRET_KEY would make saved API keys unreadable.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
mkdir -p secrets
chmod 700 secrets
for name in worker_token auth_secret_key engine_secret_key; do
  if [ -s "secrets/$name" ]; then echo "ada   secrets/$name"; continue; fi
  openssl rand -hex 32 > "secrets/$name"
  # readable inside the container (the folder itself stays private to this user)
  chmod 644 "secrets/$name"
  echo "dibuat secrets/$name"
done
echo "Simpan salinan secrets/ di tempat aman, terpisah dari cadangan data. Tanpa engine_secret_key, API key tersimpan tidak bisa dibuka."
