# Environments

| Branch | Environment | Provider app | Admin app | Database |
|---|---|---|---|---|
| `main` | **prod** (`phr-*` containers) | https://app.premierhealthcentres.com | https://admin.premierhealthcentres.com | `phr-postgres` |
| `dev` | **dev** (`phrtest-*` containers) | https://phr-test.preview.commerce.storefactory.shop | https://phr-test-admin.preview.commerce.storefactory.shop | `phrtest-postgres` |
| any PR into `dev`/`main` | **preview** (`phr-pr-<n>-*`) | https://phr-pr-<n>.preview.commerce.storefactory.shop | https://phr-pr-<n>-admin.preview.commerce.storefactory.shop | dev's (`phrtest-postgres`) |

Dev and previews sit behind the same HTTP basic-auth login (user `preview`); the API under
`/api` does not, so the website preview and the mobile app keep working against dev.

**Promotion path:** feature branch → PR into `dev` (preview builds) → merge (dev
auto-deploys) → PR `dev` → `main` → merge (**prod auto-deploys**). A push to `main` is a
production release. The `develop` branch is stale (47 commits behind) and unused;
`dev` replaced it. The marketing website on Vercel deploys separately (below).

## How a deploy works (server, admin, provider)

Everything runs on **hetzner-prod** (`2.29.1.139`, sf-prod-1) behind the StoreFactory
Traefik. `.github/workflows/hetzner-deploy.yml` (push to `main`/`dev`) and
`hetzner-preview.yml` (pull requests) SSH in with a deploy key that can only run
`/opt/phr-deploy/bin/phr-deploy` with a fixed argument grammar
(`deploy/bin/phr-deploy-ssh`). The tool then:

1. Fetches the commit into a bare mirror (`/opt/phr-deploy/repo.git`) and refuses a prod
   deploy of anything not on `main` (dev: not on `dev`).
2. Works out which images changed since what is running — **server**, **provider** or
   **admin** — from the paths in `deploy/lib/common.sh` (each app's runtime
   `@medplum/*` dependency closure, plus the root lockfile). Unchanged images are kept;
   an image whose inputs match one already built (e.g. the PR head the preview built,
   now merged) is re-tagged instead of rebuilt. Images are tagged
   `phr/medplum-<component>:<sha12>`.
3. **Prod only, when the server changes:** takes a verified backup first and aborts the
   deploy if that fails (Medplum migrations only go forward).
4. Writes the new image tags into the managed block at the bottom of the env's `.env`,
   installs `deploy/compose/stack.yml` as the env's `docker-compose.yml`, and
   `docker compose up -d`.
5. Waits for every container to be healthy, then runs `phr-smoke` through Traefik
   (API `/healthcheck` with postgres+redis ok, both UIs answer; optionally a real login +
   patient search, see `deploy/config/smoke.env.example`).
6. On failure, **rolls back automatically** to the previous image set and fails the
   workflow. On a successful prod deploy the tool also updates itself from `deploy/` in
   that commit — only `main` can change the deploy tool.

The env directories are still the ones the StoreFactory console uses
(`/opt/storefactory/stores/premier-health-records`, `/opt/storefactory/envs/premier-health-records/test`),
so suspend/resume from the console keeps working. Do not hand-edit their
`docker-compose.yml`; change `deploy/compose/stack.yml` and deploy. Secrets stay in each
env's `.env` above the managed block, entered by hand over SSH — never in the repo.

### Previews (feature branches)

Each PR into `dev` or `main` from a branch in this repo gets its own preview, and a
sticky PR comment with the links. It runs **only what the branch changed**:

| Branch changes | Preview runs | `/api` goes to |
|---|---|---|
| provider and/or admin code | rebuilt UI(s); the other UI reuses dev's image | dev's server |
| server code | its own server build, HTTP only (`MEDPLUM_WORKERS_ENABLED=[]`) | the preview's server |
| nothing deployable (docs, website, mobile, bots, CI) | nothing — the comment says so | — |

The database (and Redis, and uploaded files) are **always dev's**: a preview can see
and change dev data, and a preview server's migrations apply to dev's database.
Background jobs (bots, subscriptions, cron) keep running on dev's server so two servers
never race for the shared queues. Closing or merging the PR tears the preview down
and prunes its images. The `dev` → `main` promotion PR gets no preview — dev is that
preview.

### Rollback

- **Automatic:** a deploy whose smoke test fails reverts itself.
- **Manual:** Actions → *Deploy* → *Run workflow* → environment + `rollback`, or on the box
  `/opt/phr-deploy/bin/phr-deploy rollback prod`. This swaps back to the previous image
  set (state in `/opt/phr-deploy/state/<env>.prev`; history in `<env>.history`).
- **Migrations are forward-only.** Rolling back runs the old server on the newer schema,
  which Medplum tolerates for additive migrations. If a migration itself is the problem,
  restore the pre-deploy backup instead: `docs/runbooks/restore.md`.
- Re-deploy a specific commit: revert it on the branch and push (preferred), or
  *Run workflow* with *Rebuild every image*.

### Where things are on the box

| Path | What |
|---|---|
| `/opt/phr-deploy/` | the tool (`bin/`, `compose/`, `lib/`), mirror, `state/`, `previews/` |
| `/opt/phr-deploy/state/ssh.log` | every command the deploy key ran |
| `/etc/phr/backup.env`, `monitor.env`, `smoke-<env>.env` | backup / alert / smoke settings (root:jake 0640) |
| `/var/backups/phr/<env>/` | local backups |
| `journalctl -u 'phr-*'` | backup and monitor runs |

First-time install (already done 2026-11-18): `deploy/install.sh`, then
`sudo deploy/install.sh --system`, then `phr-deploy adopt prod|dev` to take over a
hand-managed env. The deploy key line in `~jake/.ssh/authorized_keys` starts with
`restrict,command="/opt/phr-deploy/bin/phr-deploy-ssh"`; its private half is only in
the `PHR_DEPLOY_SSH_KEY` repo secret.

## Marketing website (Next.js, `examples/website`)

Vercel project **premierhealthrecords-app**, team **Piranha Studios**, root directory
`examples/website`.

| Environment | URL |
|---|---|
| Production | `https://premierhealthrecords-app.vercel.app` |
| Dev | `https://premierhealthrecords-app-git-develop-piranha-studios.vercel.app` |

Vercel gives every branch a stable `…-git-<branch>-…vercel.app` alias for free, which is
why the dev site needs no custom domain. Vercel skips a build when a branch points at a
commit that has already been deployed, so a brand-new branch only gets its alias once it
has a commit of its own.

Environment variables live in Vercel (Project → Settings → Environment Variables), never
in `.env.local`, which is git-ignored and local only. `.env.example` lists the names.

### Analytics (PostHog)

| Variable | Scope | Notes |
|---|---|---|
| `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` | Production **and** Preview | `NEXT_PUBLIC_` values are inlined at build time, and the dev site is a Preview build, so Production alone is not enough. |
| `NEXT_PUBLIC_POSTHOG_HOST` | Production **and** Preview | `https://eu.i.posthog.com`. Browsers reach it through the same-origin `/ingest` rewrite in `next.config.mjs`, not directly, so ad blockers do not drop events. |
| `POSTHOG_CLI_API_KEY` | Production | Personal API key with the `error tracking write` and `organization read` scopes, used to upload browser source maps at build time. |
| `POSTHOG_CLI_PROJECT_ID` | Production | PostHog project id for that upload. |
| `POSTHOG_CLI_HOST` | Production | `https://eu.posthog.com`; the CLI defaults to the US region. |

Source maps are uploaded and then deleted by `scripts/upload-sourcemaps.mjs`, chained from
the `build` script. Without the CLI variables the build still deletes them, so enabling
`productionBrowserSourceMaps` never publishes the site's source.

## Medplum projects

The prod server hosts two projects; a second project costs nothing:

| Project | Id | Used by |
|---|---|---|
| `Douala` | `161452d9-43b7-5c29-aa7b-c85680fa45c6` | Production, and the provider/admin apps |
| `Douala (dev)` | `c4c16ab3-e93d-47b3-a106-2030dcf79f1a` | Vercel Preview only |

Each has its own website ClientApplication, so test bookings on the dev site never reach
live patient data. (This predates the separate dev environment above, which has its own
server and database; the website preview still uses `Douala (dev)` on prod.)

`docker-compose.full-stack.yml` is the old single-box/Coolify compose file and is **not**
what runs in prod; `deploy/compose/stack.yml` is. `docker-compose.caldiy.yml` is an
optional overlay for the Cal.diy booking widget, not part of the default deploy.

### Working in the dev project

The `Douala (dev)` project on the **prod** server is for rehearsing *data and permission*
changes (and backs the website preview). Log in to the prod apps, and the sign-in page
offers a project chooser — pick `Douala (dev)` and every screen is scoped to it. Choosing
`Douala` puts you back on live, so check which one you picked before creating anything.

Both projects carry the same staff logins and the same access policies, so a permissions
change can be rehearsed there before it touches live:

    node scripts/seed-users.mjs --base https://app.premierhealthcentres.com/api \
      --project c4c16ab3-e93d-47b3-a106-2030dcf79f1a

To test **code** changes to the server, provider or admin app, use the dev environment or
a PR preview instead — they run the new code against their own database.

**Gotcha when renaming a project.** The name shown in the sign-in chooser is
`ProjectMembership.project.display`, a copy taken when the membership was created, not the
`Project.name`. Renaming a project leaves every membership showing the old name. Worse, the
project-admin access policy marks `ProjectMembership.project` read-only
(`packages/server/src/fhir/accesspolicy.ts`), so a project admin's write of the corrected
display is silently discarded and returns 200. Rewrite the memberships as a **super admin**.

### Turning online booking on and off

`BOOKING_ENABLED` is the master switch and is **opt-in**: anything but `true`/`1`/`on`/`yes`
(including unset) turns booking off, whatever credentials are present. Booking raises
invoices and takes payment, so it must never enable itself by accident.

| Environment | `BOOKING_ENABLED` |
|---|---|
| Production | `false` — the dialog shows the clinic phone number instead |
| Preview | `true` — books against `Douala (dev)` |

When off, the booking dialog offers the phone number from `siteSettings`, and
`/api/booking*` returns 503 so it cannot be driven directly either. The server log says why
booking is off on each render.

Sites are matched to FHIR by **slug** (`Location.identifier` = `.../sid/site|<slug>`), not by
a raw id, so the single Sanity `location` document resolves correctly in both projects.

## Content (Sanity)

One project (`ciwnv4el`), one dataset (`production`), shared by both environments. Drafts are
not visible on the live site unless `SANITY_SHOW_DRAFTS=true`, which is set on Preview only.
Publishing in the Studio therefore affects both environments at once.

## Database durability and backups

Data lives in Docker volumes that the compose file declares **external**
(`premier-health-records_phr-postgres-data`, `…_phr-redis-data`, `…_phr-binary`, and the
`phr-test_phrtest-*` equivalents), so neither a deploy nor `docker compose down -v` can
remove them. Losing them takes `docker volume rm`, or the disk.

`phr-backup` (`deploy/bin/phr-backup`) dumps Postgres (`pg_dump -Fc`, checked with
`pg_restore --list`) and tars the binary volume (uploaded documents). Systemd timers run
it nightly for prod at 01:30 UTC (30 days kept) and weekly for dev (7 days), and every
prod deploy that changes the server runs it first. Restore: `docs/runbooks/restore.md`
(drill on 2026-11-18: 35 s, counts identical to live).

**Still to switch on** (needs accounts/keys only you can create — see
`docs/production-readiness.md`): off-site copies (`RCLONE_REMOTE`), encryption
(`AGE_RECIPIENT`), and healthchecks.io dead-man's switches in `/etc/phr/backup.env`.
Until then backups sit on the same disk as the database.

Redis keeps RDB snapshots and now an append-only file. `phr-deploy` turns AOF on in the
running Redis before recreating it: restarting Redis with `--appendonly yes` and no AOF
starts it **empty**, ignoring the RDB (verified on the box).
