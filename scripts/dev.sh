#!/usr/bin/env bash

# Start the local dev stack: Postgres + Redis in Docker, then the
# Provider EHR and FHIR server with hot reload.
#
#   Provider EHR:  http://localhost:3000
#   FHIR server:   http://localhost:8103
#
# The admin console (packages/app) is intentionally left out by default.
# To include it, run with: --with-admin

# Fail on error
set -e

WITH_ADMIN=0
for arg in "$@"; do
  case "$arg" in
    --with-admin)
      WITH_ADMIN=1
      ;;
    -h|--help)
      echo "Usage: $0 [--with-admin]"
      echo "  --with-admin   Also run the admin app (packages/app)"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: $0 [--with-admin]" >&2
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Require Node 22.18+ (see package.json "engines")
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node $(node -v) detected; this repo needs Node >=22.18 (see 'engines'). Try 'nvm use 22'." >&2
  exit 1
fi

# Pick whichever Compose is installed: the `docker compose` plugin or the
# standalone `docker-compose` binary.
if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  echo "Neither 'docker compose' nor 'docker-compose' is installed." >&2
  exit 1
fi

# Bring up the required background services (Postgres + Redis). Idempotent.
$COMPOSE up -d

# In the background: once the FHIR server is healthy, provision the scoped staff
# logins (frontdesk@ / nurse@example.com, password medplum_user) and the Cameroon
# reference data (terminology/ValueSets, insurers, care templates) so local matches
# live. Both are idempotent; self-terminates if the server never comes up (e.g. Ctrl-C).
(
  for _ in $(seq 1 150); do
    if curl -fsS 'http://localhost:8103/healthcheck' >/dev/null 2>&1; then
      node "$SCRIPT_DIR/seed-users.mjs" || echo 'seed-users: failed (see output above)' >&2
      node "$SCRIPT_DIR/seed-cameroon.mjs" || echo 'seed-cameroon: failed (see output above)' >&2
      exit 0
    fi
    sleep 2
  done
  echo 'seed-users/seed-cameroon: server not healthy in time; skipped. Run: node scripts/seed-users.mjs && node scripts/seed-cameroon.mjs' >&2
) &

# Run the Provider EHR + FHIR server with hot reload
TURBO_ARGS=(
  --filter=./examples/medplum-provider
  --filter=./packages/server
)

if [ "$WITH_ADMIN" -eq 1 ]; then
  TURBO_ARGS+=(--filter=./packages/app)
fi

exec npx turbo run dev "${TURBO_ARGS[@]}"
