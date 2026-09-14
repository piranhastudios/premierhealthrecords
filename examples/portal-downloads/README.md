# Portal downloads

A one-page site for installing the latest **Android test build** of the patient
portal, so testers do not need an Expo account or a link pasted into chat.

**https://phc-portal-downloads.vercel.app** — password protected (Vercel
Deployment Protection, `deploymentType: all`). Share the URL and the password
with testers; no Vercel or Expo account needed.

Deployed on Vercel (team `piranha-studios`, project `phc-portal-downloads`).
Two endpoints back it:

| Route | Does |
| --- | --- |
| `/api/latest` | 302s to the newest finished APK. This is the URL to QR-code or share. |
| `/api/info` | Build metadata (version, commit, date) for the page to render. |

Both take an optional `?profile=` (default `preview`) matching an `eas.json`
build profile.

## Why it resolves live

EAS artifact URLs **expire** — roughly two weeks, and the build record carries an
`expirationDate`. A page with a baked-in link silently starts 404ing, which is
worse than no page when someone is mid-install. `/api/latest` therefore asks the
EAS GraphQL API at click time and redirects, so the link never goes stale and
automatically picks up each new build.

## Configuration

One environment variable: `EXPO_TOKEN`, an expo.dev access token. The app id is
pinned in `api/_eas.js`.

## Access

Vercel **password protection** is on for all deployments, and the pages are
`noindex`/`nofollow` (meta tag plus an `X-Robots-Tag` header from `vercel.json`).
Vercel SSO is off, so testers do not need a Vercel account — just the password.

An automation bypass secret exists for scripted checks; send it as the
`x-vercel-protection-bypass` header.

## Deploying

Pushes to `main` deploy automatically. Two project settings make that work, and
neither can live in `vercel.json` — they are Vercel project settings:

| Setting | Value | Why |
| --- | --- | --- |
| Root Directory | `examples/portal-downloads` | Without it Vercel builds from the repo root and runs the monorepo's `npm run build`, which fails on `@medplum/generator` (it imports the Docusaurus `docs/` this fork deleted). That broke every Git deploy until it was set. |
| Ignored Build Step | `git diff --quiet HEAD^ HEAD -- .` | Exit 0 means skip, so unrelated monorepo pushes do not rebuild this site. |

Root Directory alone was not enough: Vercel still detected the Turborepo above
it, installed the whole monorepo and ran `turbo run build`, which failed with
"Could not resolve workspaces". `vercel.json` therefore sets empty
`installCommand` and `buildCommand` — this site has no dependencies and nothing
to compile, just static files and two functions.

Manual deploy, from this directory:

    npx vercel deploy --prod --scope piranha-studios

Not an npm workspace (the root `workspaces` globs do not match this directory),
so it never touches the monorepo lockfile. It is also in `.dockerignore`, so the
server/provider/app images do not copy it.
