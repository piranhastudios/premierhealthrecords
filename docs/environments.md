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

There is currently **one** Medplum server. The dev website therefore has no backend of its
own: leave `MEDPLUM_CLIENT_ID` / `MEDPLUM_CLIENT_SECRET` unset on Preview and the booking
dialog degrades to "call us" instead of writing test bookings into live patient data. When a
dev backend is wanted, add a second Medplum **Project** on the same server (free — it is one
more project, not one more server) and point the Preview variables at a client created there.

## Content (Sanity)

One project (`ciwnv4el`), one dataset (`production`), shared by both environments. Drafts are
not visible on the live site unless `SANITY_SHOW_DRAFTS=true`, which is set on Preview only.
Publishing in the Studio therefore affects both environments at once.
