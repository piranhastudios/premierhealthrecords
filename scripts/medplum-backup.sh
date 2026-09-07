#!/usr/bin/env bash
# Nightly backup of the Medplum Postgres database.
#
# The database lives in a named Docker volume that survives redeploys, so a normal
# deploy does not lose data. What WOULD lose it is the volume being removed
# (`docker compose down -v`, Coolify's "delete volumes"), disk failure, or a bad
# migration. This dump is the only thing that recovers from those.
#
# Install on the server (as root):
#   install -m 755 medplum-backup.sh /usr/local/bin/medplum-backup.sh
#   ( crontab -l 2>/dev/null; echo "30 1 * * * /usr/local/bin/medplum-backup.sh >> /var/log/medplum-backup.log 2>&1" ) | crontab -
#
# Restore (destructive — check you have the right file first):
#   gunzip -c /data/backups/medplum/medplum-YYYY-MM-DD.dump.gz > /tmp/r.dump
#   docker cp /tmp/r.dump <postgres-container>:/tmp/r.dump
#   docker exec <postgres-container> pg_restore -U medplum -d medplum --clean --if-exists /tmp/r.dump
set -euo pipefail

BACKUP_DIR=${BACKUP_DIR:-/data/backups/medplum}
KEEP_DAYS=${KEEP_DAYS:-14}
DB_NAME=${DB_NAME:-medplum}
DB_USER=${DB_USER:-medplum}

# Find the running Postgres container rather than hard-coding the Coolify suffix,
# which changes if the stack is recreated.
CONTAINER=$(docker ps --filter "name=^postgres-" --format '{{.Names}}' | head -1)
if [ -z "$CONTAINER" ]; then
  echo "$(date -Is) ERROR: no running postgres container found" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP=$(date +%F)
TARGET="$BACKUP_DIR/$DB_NAME-$STAMP.dump.gz"

# Custom format (-Fc) so pg_restore can be selective; piped straight out so the
# dump never has to fit inside the container.
docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc | gzip -9 > "$TARGET.partial"
mv "$TARGET.partial" "$TARGET"

SIZE=$(du -h "$TARGET" | cut -f1)
echo "$(date -Is) wrote $TARGET ($SIZE)"

# A dump that cannot be listed is not a backup. Fail loudly if it is unreadable.
if ! gunzip -c "$TARGET" | pg_restore --list > /dev/null 2>&1; then
  if ! docker exec -i "$CONTAINER" sh -c 'cat > /tmp/verify.dump && pg_restore --list /tmp/verify.dump > /dev/null && rm -f /tmp/verify.dump' < <(gunzip -c "$TARGET"); then
    echo "$(date -Is) ERROR: $TARGET failed verification" >&2
    exit 1
  fi
fi
echo "$(date -Is) verified $TARGET"

find "$BACKUP_DIR" -name "$DB_NAME-*.dump.gz" -mtime "+$KEEP_DAYS" -delete
echo "$(date -Is) kept $(find "$BACKUP_DIR" -name "$DB_NAME-*.dump.gz" | wc -l | tr -d ' ') backup(s), pruning older than $KEEP_DAYS days"
