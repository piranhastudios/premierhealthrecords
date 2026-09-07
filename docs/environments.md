# Environments

Two environments, both on free tiers. No custom domains.

## Branches

| Branch | Purpose | Deploys to |
|---|---|---|
| `main` | Live | Vercel Production + the Coolify stack on the Fasthosts server |
| `develop` | Dev / staging | Vercel Preview only |

Work on a feature branch, merge into `develop` to try it on the dev URL, then merge
`develop` into `main` to go live. **A push to `main` rebuilds the production stack**
(server, admin app, provider app), so treat it as a release.

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

## Backend (Medplum, Coolify on Fasthosts)

`https://app.premierhealthcentres.com` — API under `/api`, admin app at the root, provider
app on its own Coolify domain. Compose file: `docker-compose.full-stack.yml`. Auto-deploy is
gated by Coolify's own toggle, so a push to `main` only rebuilds when that is enabled.

`docker-compose.caldiy.yml` is an **optional overlay** for the Cal.diy booking widget and is
not part of the default deploy. See
`examples/medplum-demo-bots/src/premierhealth/CALDIY.md`.

One Medplum server, two projects on it — a second project costs nothing:

| Project | Id | Used by |
|---|---|---|
| `Douala` | `161452d9-43b7-5c29-aa7b-c85680fa45c6` | Production, and the provider/admin apps |
| `Douala (dev)` | `c4c16ab3-e93d-47b3-a106-2030dcf79f1a` | Vercel Preview only |

Each has its own website ClientApplication, so test bookings on the dev site never reach
live patient data. The dev project was seeded with the same site, services, prices and
clinicians (`seed-cameroon-sites.mjs --project <id>`).

### Working in the dev project

There is no separate dev deployment of the provider or admin app, and none is needed: the
same apps serve both projects. Log in as usual and the sign-in page offers a project
chooser — pick `Douala (dev)` and every screen is then scoped to dev data. Choosing
`Douala` puts you back on live, so check which one you picked before creating anything.

Both projects carry the same staff logins and the same access policies, so a permissions
change can be rehearsed on dev before it touches live:

    node scripts/seed-users.mjs --base https://app.premierhealthcentres.com/api \
      --project c4c16ab3-e93d-47b3-a106-2030dcf79f1a

A dev deployment of the apps themselves would only be worth building to test **code**
changes to the provider or admin app against a running server. That means a second Coolify
stack from `develop` with its own Postgres, which costs server memory and disk. The website
is the only part of the system whose code has a free per-branch deployment.

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

## Database durability

The Medplum database lives in the Docker named volume
`lb8d6788oexaznj9u39kmky8_medplum-postgres-data`. It is **not** recreated by a
deploy: the volume was created 2026-05-02 and has survived every redeploy since.
A deploy restarts the containers (about a minute of downtime, Postgres included)
but leaves the volume alone.

What would actually lose the data:
- `docker compose down -v`, or Coolify's "delete volumes" option when stopping the
  resource. Never use either on this stack.
- Renaming the volume in `docker-compose.full-stack.yml`. Docker would create a new
  empty one and the old data would still be on disk but unused.
- Disk failure.

**Backups.** `scripts/medplum-backup.sh` is installed at
`/usr/local/bin/medplum-backup.sh` and runs nightly at 01:30 UTC via root's crontab,
writing a verified `pg_dump` to `/data/backups/medplum/` and keeping 14 days.
Coolify's own scheduled-backup feature does not cover this database, because
Postgres is a service inside the compose stack rather than a Coolify-managed
database resource — which is why the cron exists. Restore instructions are in the
script header. Backups are on the same disk as the database, so copy them off-box
before this holds real patient data.
