#!/usr/bin/env bash
# Builds the real web image, runs it behind Caddy with the stub worker on a spare port, runs the e2e checks, then removes everything.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -s secrets/worker_token ] || bash scripts/init.sh >/dev/null
export CADDY_HTTP_PORT="${E2E_PORT:-3100}" CADDY_HTTPS_PORT=3543 APP_URL="http://localhost:${E2E_PORT:-3100}" COMPOSE_PROJECT_NAME=autobot-e2e
C="docker compose -f docker-compose.yml -f test/docker-compose.e2e.yml"
trap '$C down --volumes >/dev/null 2>&1' EXIT
$C up -d --build web caddy worker >/dev/null
for i in $(seq 1 40); do curl -sf "localhost:$CADDY_HTTP_PORT/api/health" >/dev/null 2>&1 && break; sleep 2; done
E2E_BASE="http://localhost:$CADDY_HTTP_PORT" node test/e2e.mjs
