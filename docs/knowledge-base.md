# Knowledge base (BookStack)

The staff wiki: standard operating procedures, platform training guides, and a
gated area per location. "Confluence but free" — BookStack is MIT-licensed and
runs as its own compose stack on the same server
(`docker-compose.docs.yml` in this repo is the reference copy of it).

Why BookStack and not the obvious alternatives:

- **Confluence Free** caps at 10 users and has *no space permissions* on the
  free tier — everyone sees everything, so per-location areas are impossible.
- **Notion / Docmost** put SSO behind paid tiers; the requirement is that staff
  sign in with their Medplum user.
- **BookStack** has OIDC login in core (Medplum is an OIDC provider), a WYSIWYG
  editor a non-technical CEO can use, and role-based permissions per shelf.

## What lives where

Git `docs/` stays the home of engineer-facing runbooks (they version with the
code that they describe). BookStack is for everything staff-facing:

| Shelf | Visible to |
|---|---|
| Platform training | All staff |
| Standard operating procedures | All staff |
| Douala Grand Mall | "Douala Grand Mall staff" role only |
| *(one shelf per future location)* | that location's role |

Admins see every shelf regardless of role — that is BookStack's built-in admin
behaviour, no configuration needed.

## Where it is right now

Deployed and running on the Hetzner box as its own compose stack at
`/opt/storefactory/stores/premier-health-docs` (BookStack + its own MariaDB,
same hand-managed pattern as the Medplum stack next to it):

| | |
|---|---|
| URL | <https://phr-docs.commerce.storefactory.shop> |
| Login | email + password (**not** Medplum SSO yet — see below) |
| Admin | `jngatchu@gmail.com` — password was set at install, change it on first login |

`docs.premierhealthcentres.com` is the intended address. Traefik is ready for
it, but the GoDaddy DNS record does not exist yet, so the router is currently
bound to the `phr-docs.commerce.storefactory.shop` name only — Let's Encrypt
refuses to issue a certificate for a hostname that does not resolve, which
takes the whole site down with it. ClickUp task `123yb693r00` tracks adding
the A record (`docs` → `2.29.1.139`) and the flip afterwards.

## Medplum SSO is blocked (BookStack is RS256-only)

Staff signing in with their Medplum account does not work yet, and it is not a
configuration mistake: **BookStack only accepts RS256-signed tokens**
(`app/Access/Oidc/OidcJwtSigningKey.php`: *"Only RS256 keys are currently
supported"*), and this Medplum signs with **ES256**. BookStack filters the
provider's JWKS down to RSA keys, finds none, and fails the login with
`Missing required configuration "keys" value`. The same restriction is still
present on BookStack's development branch, so waiting for an upgrade will not
fix it.

Everything else for SSO is already in place: the `bookstack` ClientApplication
exists in the Douala project, its id/secret are in the stack's `.env`, and
`OIDC_ISSUER` matches the issuer the server now advertises. Only the signing
algorithm is in the way. `BOOKSTACK_AUTH_METHOD` is therefore set to
`standard`; flipping it to `oidc` before the algorithm is sorted out leaves a
login page whose only button is broken.

Getting from here to SSO needs a decision, because Medplum picks its signing
key as `jsonWebKeys[0]` from an **unsorted** search of active JsonWebKey
resources (`packages/server/src/oauth/keys.ts`) — with two active keys, which
one signs is not deterministic across restarts. So adding an RS256 key
alongside the ES256 one is not enough. The options:

1. **Make an RS256 key the only active one.** Medplum supports RS256 (it was
   the default for years and is still the fallback). Cost: every existing
   token stops verifying, so everyone is signed out once — cheap today, much
   less so after go-live. Reversible by reactivating the old key.
2. **Change the fork** to choose the signing key deterministically (e.g. an
   algorithm set in config) instead of relying on row order. Cleaner and
   avoids the forced sign-out, but it means building and deploying a new
   server image.
3. **Leave the wiki on its own passwords.** No Medplum involvement, no risk,
   but everyone has a second account to manage.

## Access recipe (per-location gating)

Medplum's tokens carry no group claim, so location access is assigned in the
wiki, by an admin, once per person — fine at this team size:

1. First SSO login auto-creates the person with the default role (viewer of
   the all-staff shelves only).
2. Settings → Roles: one role per location, e.g. `Douala Grand Mall staff`
   (no system permissions needed — view/edit rights come from the shelf).
3. On each location shelf: Permissions → tick *Override defaults*, remove the
   public/default roles, grant View (and Edit for those who maintain it) to
   the location role, and apply the permissions down to the books inside.
4. Add each new hire to their location's role after their first login.

Give the CEO (and anyone else who edits everywhere) the built-in **Admin**
role: sees all shelves, edits all content, manages users.

## Backups

The wiki's state is the `bookstack-db-data` volume (MariaDB) plus
`bookstack-data` (uploaded images/attachments). The nightly
`medplum-backup.sh` cron covers **only** the Medplum Postgres — extend it (or
add a sibling cron) with a `mariadb-dump` of the `bookstack` database and a
tar of the `/config` uploads before the wiki holds anything hard to rewrite.
