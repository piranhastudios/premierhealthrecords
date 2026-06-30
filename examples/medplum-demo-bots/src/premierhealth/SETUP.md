# Premier Health Messaging — Go-Live Setup

Prod base URL: `https://app.premierhealthcentres.com/api/`
Public webhook form: `https://app.premierhealthcentres.com/api/webhook/{ProjectMembershipId}`

> **No new Coolify / server env vars are required.** Bots (vmcontext), Redis, and the base URL are
> already set in `docker-compose.full-stack.yml`. The messaging credentials below are **Medplum
> Project Secrets** — vmcontext bots read them from `event.secrets`, not `process.env`, so they go in
> the **admin app → Project → Secrets**, *not* Coolify. Realtime is enabled by a one-time PATCH
> (step 3), also not an env var.

## 1. Deploy the 4 bots (authenticated `@medplum/cli`)
```bash
cd examples/medplum-demo-bots
npm run build
# `bot create` registers + deploys and writes the id into medplum.config.json:
npx medplum bot create premierhealth-outbound-dispatch
npx medplum bot create premierhealth-twilio-whatsapp-inbound
npx medplum bot create premierhealth-twilio-status-callback
npx medplum bot create premierhealth-inbound-email
# later code changes: npx medplum bot deploy <name>
```
For the **3 webhook bots** (`twilio-whatsapp-inbound`, `twilio-status-callback`, `inbound-email`):
set `Bot.publicWebhook = true`, and give each bot's ProjectMembership an AccessPolicy
(CRUD `Communication`/`Task`/`DocumentReference`/`Binary`; read `Patient`/`Basic`). Capture each
membership id for the URLs below:
```
GET /fhir/R4/ProjectMembership?profile=Bot/{botId}   →  .id
```

## 2. Project Secrets  (admin app → Project → Secrets)
| Secret | Value | Notes |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | `AC…` your **LIVE** account SID | used in production; also the sandbox fallback |
| `TWILIO_AUTH_TOKEN` | your **LIVE** auth token | used to send **and** to validate inbound signatures |
| `TWILIO_SANDBOX` | `true` | **dev-mode flag** — sandbox now; set `false` for production |
| `TWILIO_TEST_ACCOUNT_SID` | _(optional)_ test `AC…` | only used when `TWILIO_SANDBOX=true`; ⚠ test creds can't send WhatsApp — leave unset to test real WhatsApp in the sandbox |
| `TWILIO_TEST_AUTH_TOKEN` | _(optional)_ test token | pairs with `TWILIO_TEST_ACCOUNT_SID` |
| `TWILIO_SANDBOX_NUMBER` | `+14155238886` | optional; default sandbox sender |
| `TWILIO_WHATSAPP_NUMBER` | _(leave unset for now)_ | required only when `TWILIO_SANDBOX=false` |
| `TWILIO_STATUS_CALLBACK_URL` | `…/api/webhook/{status-callback membershipId}` | fill after step 1 |
| `RESEND_API_KEY` | your Resend API key | also grants the inbound receiving API |
| `RESEND_FROM_ADDRESS` | `Premier Health <care@yourdomain>` | verified Resend sender |
| `INBOUND_EMAIL_PROVIDER` | `resend` | selects the Resend fetch path |
| `TRIAGE_RECIPIENT` | `Practitioner/{id}` or `CareTeam/{id}` | owner of unassigned/triage threads |

**Dev-mode flag (`TWILIO_SANDBOX`)** — `true` sends from the sandbox number; flip to `false` (or remove)
and set `TWILIO_WHATSAPP_NUMBER` to go production. The account SID + auth token are identical in both
modes. (`INBOUND_EMAIL_SIGNING_SECRET` is **not** used with Resend — its webhook is Svix-signed and the
bot trusts the authenticated content re-fetch instead.)

## 3. Enable realtime — one-time PATCH (super-admin)
```
PATCH /fhir/R4/Project/{projectId}     Content-Type: application/json-patch+json
[{ "op": "add", "path": "/features", "value": ["websocket-subscriptions"] }]
```
Clears the inbox's "WebSocket subscriptions not enabled" error.

## 4. Twilio Sandbox webhooks
Console → Messaging → *Try it out → Send a WhatsApp message → **Sandbox settings***:
- **When a message comes in** (HTTP **POST**) → `https://app.premierhealthcentres.com/api/webhook/{whatsapp-inbound membershipId}`
- **Status callback URL** → `https://app.premierhealthcentres.com/api/webhook/{status-callback membershipId}`

Each test phone must first **join the sandbox** (send the join code to `+14155238886`).

## 5. Resend inbound webhook
Resend dashboard → **Webhooks** → add endpoint
`https://app.premierhealthcentres.com/api/webhook/{inbound-email membershipId}` and subscribe to the
**`email.received`** event. (The bot fetches the body/headers from Resend's receiving API using `RESEND_API_KEY`.)

## 6. Outbound dispatch Subscription (create once)
```json
{
  "resourceType": "Subscription",
  "status": "active",
  "criteria": "Communication?part-of:missing=false",
  "channel": { "type": "rest-hook", "endpoint": "Bot/{outbound-dispatch botId}" },
  "extension": [
    { "url": "https://medplum.com/fhir/StructureDefinition/subscription-supported-interaction", "valueCode": "create" },
    { "url": "https://medplum.com/fhir/StructureDefinition/fhir-path-criteria-expression", "valueString": "%current.sender.reference.startsWith('Practitioner/')" }
  ]
}
```

## Smoke test
1. Open the inbox → no "WebSocket subscriptions not enabled" toast (step 3 done).
2. Join the sandbox, WhatsApp `+14155238886` from a test patient's phone → message appears in the inbox
   (triage queue or the patient's thread); the header gains a 24h window.
3. Reply from the inbox within the window → delivered on WhatsApp; the message gets a delivery tick and
   carries `identifier twilio-message|{sid}` + `delivery-status`.
4. Email a patient via the inbox (Email channel) → patient replies → reply lands back in the same thread.
