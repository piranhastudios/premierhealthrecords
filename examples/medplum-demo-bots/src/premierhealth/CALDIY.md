# Cal.diy booking widget — runbook

Cal.diy (the MIT community edition of Cal.com) is the **public booking widget** on the
marketing website. **Medplum is the system of record.** Two bots keep them in sync:

| Direction | Bot | Trigger |
|---|---|---|
| Cal.diy → Medplum | `premierhealth-caldiy-webhook` | Cal.diy webhook: `BOOKING_CREATED`, `BOOKING_RESCHEDULED`, `BOOKING_CANCELLED` → busy `Slot` + `Appointment` (identifier `…/sid/caldiy-booking`) |
| Medplum → Cal.diy | `premierhealth-caldiy-mirror` | Subscription on `Appointment` (excluding Cal.diy-origin ones) → mirror booking via API v2 (identifier `…/sid/caldiy-mirror`, metadata `source=medplum`) |

Loop guards: the webhook bot skips bookings with `metadata.source = medplum` and uids it
already knows as mirrors; the mirror bot skips appointments carrying the `caldiy-booking`
identifier and unchanged `{start,end,status}` state. Cal.diy has **no SMTP** configured:
confirmations, reminders and cancellations all come from Medplum
(`premierhealth-appointment-notify` / `premierhealth-appointment-reminders`).

## 1. Deploy (Coolify)

Services live in `docker-compose.full-stack.yml`: `cal-postgres`, `caldiy` (web, port
3000, **built from the `calcom/cal.diy` git tag v6.2.0** — the Docker Hub repo
`calcom/cal.diy` has no published tags; the build needs ~6 GB RAM and 15–30 min),
`caldiy-api` (API v2, port 5555, built from the same tag, internal only).

Quick local trial without the long build (what the 2026-09-07 UAT used):

```
docker network create caldiy
docker run -d --name cal-pg --network caldiy -e POSTGRES_USER=calcom -e POSTGRES_PASSWORD=calcom -e POSTGRES_DB=calcom postgres:16
docker run -d --name caldiy --network caldiy -p 3002:3000 --add-host=host.docker.internal:host-gateway \
  -e DATABASE_URL=postgresql://calcom:calcom@cal-pg:5432/calcom -e DATABASE_DIRECT_URL=postgresql://calcom:calcom@cal-pg:5432/calcom \
  -e NEXT_PUBLIC_WEBAPP_URL=http://localhost:3002 -e NEXTAUTH_URL=http://localhost:3002 \
  -e NEXTAUTH_SECRET=<random> -e CALENDSO_ENCRYPTION_KEY=<24+ chars> -e NEXT_PUBLIC_LICENSE_CONSENT=agree \
  -e CALCOM_TELEMETRY_DISABLED=1 -e TZ=Africa/Douala calcom/cal.com:v6.2.0-arm   # amd64: drop -arm
```

(`calcom/cal.com` is the AGPL image; booking pages and webhooks behave the same.) From the
container, Medplum on the host is `http://host.docker.internal:8103`, so the webhook
subscriber URL becomes `http://host.docker.internal:8103/webhook/<membership-id>`.

Set these in the Coolify env store **before** the compose change deploys:

```
CALDIY_DB_PASSWORD=<random>
CALDIY_NEXTAUTH_SECRET=$(openssl rand -base64 32)
CALDIY_ENCRYPTION_KEY=$(openssl rand -base64 24)
CALDIY_JWT_SECRET=$(openssl rand -base64 32)
CALDIY_PUBLIC_URL=https://book.premierhealthcentrescameroon.com
CALDIY_DISABLE_SIGNUP=0            # flip to 1 after step 2
```

In Coolify add the domain `book.premierhealthcentrescameroon.com` for the `caldiy`
service (Traefik label already binds port 3000 with the stack's UUID). Check the
booking page does not link to `localhost`: if it does, the image lacks the
`replace-placeholder.sh` start hook and Cal.diy must be built from source with
`NEXT_PUBLIC_WEBAPP_URL` as a build arg.

Verify:

```
curl -I https://book.premierhealthcentrescameroon.com/auth/login          # 200
docker compose exec caldiy-api wget -qO- http://127.0.0.1:5555/health     # ok
```

## 2. Users, availability, event types

1. Open `https://book.premierhealthcentrescameroon.com/auth/setup` → create the **admin**.
2. Create **one Cal.diy user per practitioner** (Settings → Admin → Users). Busy time is
   per user in Cal.com, so a shared user would let Dr A's booking block Dr B.
   Note each user id → it goes into `caldiy-links.json` as `calUserId`.
3. Set `CALDIY_DISABLE_SIGNUP=1` and redeploy.
4. Per user → Availability: one schedule **per site** whose hours **mirror Medplum**
   (Douala Grand Mall: 09:00–19:00 every day, timezone Africa/Douala). Medplum's
   `SchedulingParameters` stay authoritative for the portal and provider app; drift
   only means Cal.diy may show hours Medplum would not — the mirror still prevents
   double bookings.
5. Per Medplum Schedule (practitioner × site; `node scripts/seed-cameroon-sites.mjs`
   prints them) → one **event type** on that user:
   - slug = the Schedule's `sid/schedule` value or a readable form of it
   - duration = the site's default service duration (30 min)
   - availability = the schedule created in step 4
   - location = **In person**, the site address
   - "Requires confirmation" **off**
   - booking questions: **Phone** (required — the Patient profile mandates a phone),
     **`service`** (identifier exactly `service`, type select, required; one option
     per HealthcareService at the site with **option value = the HealthcareService
     id** and label = its name), optional **Notes**.
6. Fill `scripts/data/caldiy-links.json` (copy the example) and run:

   ```
   node scripts/seed-caldiy-links.mjs --base https://app.premierhealthcentres.com/api \
     --email <admin> --password <pw>
   ```

   This writes `caldiy-event-type` / `caldiy-cal-link` on each Schedule and
   `caldiy-user` on each Practitioner. The website reads `caldiy-cal-link`.

## 3. API key + webhook

1. Admin user → Settings → Developer → **API keys** → create one that never expires.
   Test that it can read other users' bookings:

   ```
   curl -H "Authorization: Bearer cal_…" -H "cal-api-version: 2026-02-25" \
     http://127.0.0.1:5555/v2/bookings/<uid-of-a-practitioner-booking>
   ```

   If that returns 403, create the key on a user that is an org/team admin or store
   per-user keys and adapt `lib/caldiy.ts` (`caldiyConfigFromSecrets`).
2. Project secrets (admin app → Project → Secrets):

   ```
   CALDIY_API_URL      http://caldiy-api:5555
   CALDIY_API_KEY      cal_…
   CALDIY_API_VERSION  2026-02-25         (optional)
   ```

   `CALDIY_WEBHOOK_URL` and `CALDIY_WEBHOOK_SECRET` are generated by
   `node scripts/seed-subscriptions.mjs` (it prints both).
3. **Per practitioner user** → Settings → Developer → Webhooks → New:
   subscriber URL = `CALDIY_WEBHOOK_URL`, secret = `CALDIY_WEBHOOK_SECRET`,
   triggers = Booking created / rescheduled / cancelled, version = latest.
   (Webhooks are per user in Cal.diy; the admin's webhook does not see other users'
   bookings.)

## 4. Verify end to end

```
# signed test delivery straight to the bot
BODY='{"triggerEvent":"BOOKING_CREATED","payload":{"uid":"test-1","eventTypeId":<id>,"startTime":"2026-09-10T09:00:00Z","endTime":"2026-09-10T09:30:00Z","attendees":[{"name":"Test Patient","email":"t@example.com","phoneNumber":"+237650000000","timeZone":"Africa/Douala"}],"responses":{"service":{"value":"<HealthcareService id>"}},"metadata":{}}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$CALDIY_WEBHOOK_SECRET" | cut -d' ' -f2)
curl -X POST "$CALDIY_WEBHOOK_URL" -H 'content-type: application/json' -H "x-cal-signature-256: $SIG" -d "$BODY"
```

- An `Appointment` with `caldiy-booking|test-1`, three participants and a busy Slot
  appears; the mirror bot logs `skipped: caldiy-origin`; the patient gets a
  confirmation via WhatsApp/email.
- Book in the provider app → the booking shows in Cal.diy under the practitioner;
  its echo webhook returns `{skipped:'mirror'}`.
- Cancel in the provider app → cancelled in Cal.diy. Cancel in Cal.diy → the
  Appointment is cancelled and its slot freed.

## Known limitations

- Availability is configured twice (Medplum rules + Cal.diy schedules). A future bot
  can push Medplum availability via `PATCH /v2/schedules`.
- Cal.diy is positioned by its maintainers for non-production use: keep the image
  pinned, keep it on its own database, and treat it as replaceable.
- The anonymous webhook policy grants Patient write; the bot never acts on a payload
  it could not verify (signature or API re-fetch).
