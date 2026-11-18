# Restore a PHR database from backup

Backups are written by `phr-backup` (see `docs/environments.md`) to
`/var/backups/phr/<env>/` on hetzner-prod, and off-site to `$RCLONE_REMOTE/<env>/` once
that is configured:

    phr-<env>-<UTC stamp>.pgdump[.age]          Postgres, pg_dump custom format
    phr-<env>-<UTC stamp>.binary.tar.gz[.age]   uploaded documents (Binary storage)

`.age` files are encrypted to the key in `AGE_RECIPIENT`; the private key is **not** on
the box (password manager). Copy it up only for the restore and delete it afterwards.

## 1. Drill: restore into a throwaway container (no downtime)

Do this quarterly, and before trusting a backup for anything else. Last run 2026-11-18:
35 s, Patient / Practitioner / Appointment / Project / Binary counts identical to live.

```sh
f=$(ls -t /var/backups/phr/prod/*.pgdump* | head -1)
# encrypted?  age -d -i ~/phr-backup.key -o /tmp/r.pgdump "$f" && f=/tmp/r.pgdump
docker run -d --rm --name phr-restore-drill --network none \
  -e POSTGRES_USER=medplum -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=medplum postgres:16
sleep 5
docker exec -i phr-restore-drill pg_restore -U medplum -d medplum --no-owner --exit-on-error < "$f"
for t in Patient Practitioner Appointment Encounter Binary; do
  echo "$t restored=$(docker exec phr-restore-drill psql -U medplum -d medplum -Atc "select count(*) from \"$t\" where deleted=false")" \
       "live=$(docker exec phr-postgres psql -U medplum -d medplum -Atc "select count(*) from \"$t\" where deleted=false")"
done
docker rm -f phr-restore-drill; rm -f /tmp/r.pgdump
```

Record the date and time taken here.

## 2. Real restore of prod (downtime: a few minutes)

Only after deciding the live data is worse than the backup — everything written since
the dump is lost. Take a dump of the current state first, even if it is broken.

```sh
cd /opt/storefactory/stores/premier-health-records
/opt/phr-deploy/bin/phr-backup prod                 # snapshot of the current state
f=/var/backups/phr/prod/phr-prod-<stamp>.pgdump     # the one to restore (decrypt first if .age)

# stop everything that talks to the database
docker stop phr-server phr-provider phr-app

docker exec phr-postgres psql -U medplum -d postgres -c "DROP DATABASE medplum WITH (FORCE)"
docker exec phr-postgres psql -U medplum -d postgres -c "CREATE DATABASE medplum OWNER medplum"
docker exec -i phr-postgres pg_restore -U medplum -d medplum --no-owner --exit-on-error < "$f"

# uploaded documents from the same night
b=${f%.pgdump}.binary.tar.gz
docker run --rm -v premier-health-records_phr-binary:/data -v "$(dirname "$b")":/b:ro postgres:16 \
  sh -c 'rm -rf /data/* && tar -C /data -xzf /b/'"$(basename "$b")"

# Redis holds caches + queues that now describe data that no longer exists
docker exec -e REDISCLI_AUTH="$(grep ^REDIS_PASSWORD= .env | cut -d= -f2-)" phr-redis redis-cli FLUSHALL

docker start phr-server && sleep 60 && docker start phr-provider phr-app
/opt/phr-deploy/bin/phr-smoke --env prod --api-host app.premierhealthcentres.com \
  --provider-host app.premierhealthcentres.com --admin-host admin.premierhealthcentres.com
```

If the restored dump is from an *older server version* than the image now running,
the server migrates it forward on start. If it is from a *newer* one (you rolled the
image back too), deploy the matching image first: `phr-deploy rollback prod`.

## 3. The box is gone

1. New Ubuntu host, Docker, the StoreFactory Traefik (`/opt/storefactory/traefik`) on
   an external `proxy` network; point DNS for the hosts in `docs/environments.md` at it.
2. Clone this repo, `deploy/install.sh && sudo deploy/install.sh --system`.
3. Recreate `/opt/storefactory/stores/premier-health-records/.env` from the password
   manager — keep a copy of the whole file there, managed block included, since secrets
   are never in git — then the external volumes:
   `docker volume create premier-health-records_phr-postgres-data` (and `_phr-redis-data`,
   `_phr-binary`).
4. Pull the latest off-site backup with rclone, then follow section 2 from
   `DROP DATABASE` on (start `phr-postgres` first with
   `docker compose up -d postgres`).
5. Re-add the deploy key line to `~/.ssh/authorized_keys`, update the
   `PHR_DEPLOY_KNOWN_HOSTS` secret, and run the Deploy workflow for prod.
