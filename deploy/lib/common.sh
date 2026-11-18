# shellcheck shell=bash
# shellcheck disable=SC2034  # variables here are consumed by the scripts that source this file
# Shared configuration for the phr-* deploy tooling on hetzner-prod.
# Sourced by bin/phr-deploy, bin/phr-backup, bin/phr-monitor and bin/phr-smoke.
#
# Anything here can be overridden in /etc/phr/deploy.conf (sourced last).

PHR_HOME=${PHR_HOME:-/opt/phr-deploy}
PHR_STATE=${PHR_STATE:-$PHR_HOME/state}
PHR_MIRROR=${PHR_MIRROR:-$PHR_HOME/repo.git}
PHR_PREVIEWS=${PHR_PREVIEWS:-$PHR_HOME/previews}
PHR_REPO_URL=${PHR_REPO_URL:-https://github.com/piranhastudios/premierhealthrecords.git}
PHR_PREVIEW_DOMAIN=${PHR_PREVIEW_DOMAIN:-preview.commerce.storefactory.shop}
PHR_BACKUP_DIR=${PHR_BACKUP_DIR:-/var/backups/phr}

# Per-environment settings. The env dirs are the ones the StoreFactory console
# already knows about, so its suspend/resume keep working from them.
env_config() {
  case "$1" in
    prod)
      ENV_DIR=/opt/storefactory/stores/premier-health-records
      ENV_PROJECT=premier-health-records
      ENV_PREFIX=phr
      ENV_BRANCH=main
      ENV_PROFILES=turn
      ENV_PG_VOLUME=premier-health-records_phr-postgres-data
      ENV_REDIS_VOLUME=premier-health-records_phr-redis-data
      ENV_BINARY_VOLUME=premier-health-records_phr-binary
      ;;
    dev)
      ENV_DIR=/opt/storefactory/envs/premier-health-records/test
      ENV_PROJECT=phr-test
      ENV_PREFIX=phrtest
      ENV_BRANCH=dev
      ENV_PROFILES=
      ENV_PG_VOLUME=phr-test_phrtest-postgres-data
      ENV_REDIS_VOLUME=phr-test_phrtest-redis-data
      ENV_BINARY_VOLUME=phr-test_phrtest-binary
      ;;
    *)
      echo "unknown environment: $1 (expected prod or dev)" >&2
      return 1
      ;;
  esac
  ENV_NAME=$1
  ENV_FILE=$ENV_DIR/.env
}

# Path prefixes whose change means an image must be rebuilt. Derived from the
# runtime @medplum/* dependency closure of each app (see docs/environments.md).
# Root manifests and the lockfile feed every image's `npm ci`.
COMMON_PATHS=(package.json package-lock.json turbo.json tsconfig.json .dockerignore
  packages/core/ packages/definitions/ packages/fhirtypes/ packages/fhir-router/)
SERVER_PATHS=(Dockerfile.server packages/server/ packages/bot-layer/ packages/ccda/)
PROVIDER_PATHS=(Dockerfile.provider examples/medplum-provider/ packages/react/ packages/react-hooks/
  packages/mock/ packages/dosespot-core/ packages/dosespot-react/ packages/scriptsure-react/
  packages/health-gorilla-core/ packages/health-gorilla-react/ packages/campaigns/)
APP_PATHS=(Dockerfile.app packages/app/ packages/react/ packages/react-hooks/ packages/mock/
  packages/campaigns/)

COMPONENTS=(server provider app)

# Reads changed file paths on stdin, prints the affected components (one per line).
components_for_paths() {
  local path p hit_server=0 hit_provider=0 hit_app=0
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    for p in "${COMMON_PATHS[@]}"; do
      if [[ $path == "$p" || $path == "$p"* ]]; then hit_server=1 hit_provider=1 hit_app=1; fi
    done
    for p in "${SERVER_PATHS[@]}"; do if [[ $path == "$p"* ]]; then hit_server=1; fi; done
    for p in "${PROVIDER_PATHS[@]}"; do if [[ $path == "$p"* ]]; then hit_provider=1; fi; done
    for p in "${APP_PATHS[@]}"; do if [[ $path == "$p"* ]]; then hit_app=1; fi; done
  done
  if [ $hit_server = 1 ]; then echo server; fi
  if [ $hit_provider = 1 ]; then echo provider; fi
  if [ $hit_app = 1 ]; then echo app; fi
  return 0
}

image_repo() {
  case "$1" in
    server) echo phr/medplum-server ;;
    provider) echo phr/medplum-provider ;;
    app) echo phr/medplum-app ;;
  esac
}

dockerfile_for() {
  case "$1" in
    server) echo Dockerfile.server ;;
    provider) echo Dockerfile.provider ;;
    app) echo Dockerfile.app ;;
  esac
}

# The managed-block variable that holds a component's image.
image_var() {
  case "$1" in
    server) echo PHR_SERVER_IMAGE ;;
    provider) echo PHR_PROVIDER_IMAGE ;;
    app) echo PHR_APP_IMAGE ;;
  esac
}

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

# Reads KEY from a dotenv file without sourcing it (values may contain $ or quotes).
dotenv_get() {
  local file=$1 key=$2
  [ -r "$file" ] || return 0
  { grep -E "^${key}=" "$file" | tail -1 | cut -d= -f2- | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"; } || true
}

# shellcheck source=/dev/null
if [ -r /etc/phr/deploy.conf ]; then . /etc/phr/deploy.conf; fi
