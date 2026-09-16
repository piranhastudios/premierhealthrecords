# Knowledge base (BookStack)

The staff wiki: standard operating procedures, platform training guides, and a
gated area per location. "Confluence but free" — BookStack is MIT-licensed and
runs as one more service on the existing Coolify stack
(`docker-compose.docs.yml`, an optional overlay like Cal.diy).

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

## Deploying it

1. **Fix the OIDC issuer first.** The server currently announces
   `https://phr.commerce.storefactory.shop/api/` as its issuer (check
   `https://app.premierhealthcentres.com/api/.well-known/openid-configuration`)
   because the stack's `MEDPLUM_BASE_URL` still carries the old deploy domain.
   Set it to `https://app.premierhealthcentres.com/api/` in the Coolify env
   store and redeploy — staff will have to sign in again (tokens carry the
   issuer), which is the whole disruption. Until it is fixed, SSO logins would
   bounce staff through the storefactory.shop domain.
2. **Secrets** in the Coolify env store:
   - `BOOKSTACK_DB_PASSWORD` — `openssl rand -base64 24`
   - `BOOKSTACK_APP_KEY` — `docker run --rm lscr.io/linuxserver/bookstack:latest appkey`
   - `BOOKSTACK_OIDC_CLIENT_ID` / `BOOKSTACK_OIDC_CLIENT_SECRET` — step 3
3. **ClientApplication in Medplum.** In the admin app, signed in to the
   **Douala** project (staff memberships live there — a client in another
   project cannot log them in), create a ClientApplication named `bookstack`
   with redirect URI `https://docs.premierhealthcentres.com/oidc/callback`.
   Copy its id and secret into the env store.
4. **Deploy** with the overlay added to the compose command
   (`-f docker-compose.docs.yml`), point DNS `docs.premierhealthcentres.com`
   at the server, and map the domain to the `bookstack` service (port 80) in
   Coolify. First boot takes a minute while MariaDB initialises.
5. **Claim the admin account.** The wiki starts with local logins
   (`AUTH_METHOD=standard`): sign in as `admin@admin.com` / `password`,
   immediately change the email to your own **Medplum login email** and set a
   real password. Then set `BOOKSTACK_AUTH_METHOD=oidc` in the env store and
   redeploy the service. BookStack matches SSO logins to existing accounts by
   email, so your Medplum login lands on the admin account. From here on the
   login page has a single "Login with Premier Health" button.

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
