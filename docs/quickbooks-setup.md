# QuickBooks Online (QBO) — Setup & Go-Live Guide

Operational, step-by-step guide for connecting the Premier Health EHR to a
QuickBooks Online company. The architecture, data mappings, and phasing are in
[docs/quickbooks-integration.md](./quickbooks-integration.md) — read that first
if you want the _why_; this document is the _how_.

> ## ⚠️ VALIDATE FIRST — QBO availability for Cameroon (BLOCKER)
>
> Intuit QuickBooks Online is not sold in every country, and the Central
> African / Cameroon market may not be a supported QBO region. **Before doing
> anything in this guide for production**, confirm that an actual QBO company
> can be provisioned for the operating entity. If a Cameroon-domiciled QBO
> company cannot be created, the options are (a) a US/global QBO company
> posting XAF invoices (requires multicurrency and raises tax/entity
> questions) or (b) an alternative ledger. See
> [Open Risks in the design doc](./quickbooks-integration.md#2-open-risks--validate-first).
> The **sandbox** test-drive below works regardless — sandbox companies are
> free developer artifacts — but do not treat a green sandbox run as
> validation of the production blocker.

---

## 1. Create the Intuit developer app (one-time)

1. Sign in at <https://developer.intuit.com> and go to **Dashboard → Create an
   app**.
2. Choose the **QuickBooks Online and Payments** platform.
3. Under scopes, select **`com.intuit.quickbooks.accounting`** (Accounting).
   This is the only scope the server requests (`QBO_OAUTH_SCOPE` in
   `packages/server/src/accounting/quickbooks.ts`).
4. The app gives you two independent key sets under **Keys & credentials**:
   - **Development keys** — work only against the **sandbox** environment.
   - **Production keys** — require completing Intuit's production requirements
     (app assessment questionnaire) before they are issued.

### 1.1 Configure the redirect URI

The server builds its OAuth callback URL as
`new URL('accounting/quickbooks/callback', baseUrl)` (see
`getQuickBooksCallbackUrl()` in `packages/server/src/accounting/routes.ts`),
i.e. **`<baseUrl>accounting/quickbooks/callback`** — the path is resolved
_relative_ to the server config `baseUrl`, so `baseUrl` must end with a
trailing slash.

Register the resulting URL **exactly** in the Intuit app's **Redirect URIs**
(per environment):

| Environment | `baseUrl`                                   | Redirect URI to register                                                  |
| ----------- | ------------------------------------------- | ------------------------------------------------------------------------- |
| Production  | `https://app.premierhealthcentres.com/api/` | `https://app.premierhealthcentres.com/api/accounting/quickbooks/callback` |
| Local dev   | `http://localhost:8103/`                    | `http://localhost:8103/accounting/quickbooks/callback`                    |

Intuit rejects the OAuth exchange if the redirect URI does not byte-for-byte
match a registered value.

### 1.2 Sandbox vs production

|              | Sandbox                                                                                                  | Production                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Intuit keys  | **Development** client id/secret                                                                         | **Production** client id/secret                              |
| QBO company  | Auto-created sandbox company (developer portal → **API Docs & Tools → Sandbox**)                         | The real QBO company (see the VALIDATE-FIRST warning)        |
| API base URL | `https://sandbox-quickbooks.api.intuit.com` (**the server default** when `QUICKBOOKS_BASE_URL` is unset) | `https://quickbooks.api.intuit.com` (must be set explicitly) |

The environment is selected by _which keys you put in the secrets_ plus the
`QUICKBOOKS_BASE_URL` secret. Mixing them (production keys against the sandbox
base URL, or vice versa) fails with 401s.

---

## 2. Project secrets

Set via **admin app → Project → Secrets**. Every secret also falls back to a
same-named server **environment variable** for single-tenant on-prem
deployments (see `getQuickBooksConfig` in
`packages/server/src/accounting/quickbooks.ts`) — but prefer project secrets:
the OAuth callback and token rotation _write back_ to project secrets, not to
the environment.

| Secret name                          | Who sets it                                      | Purpose                                                                                                                                   |
| ------------------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `QUICKBOOKS_CLIENT_ID`               | **Admin, before connect**                        | Intuit app client id (Development or Production keys).                                                                                    |
| `QUICKBOOKS_CLIENT_SECRET`           | **Admin, before connect**                        | Intuit app client secret. Also the HMAC key that signs the OAuth `state` parameter.                                                       |
| `QUICKBOOKS_BASE_URL`                | **Admin (optional)**                             | API base URL. Unset ⇒ **sandbox** (`https://sandbox-quickbooks.api.intuit.com`). Set to `https://quickbooks.api.intuit.com` to go live.   |
| `QUICKBOOKS_REALM_ID`                | _Written by the connect callback_                | QBO company id returned by Intuit on the OAuth redirect.                                                                                  |
| `QUICKBOOKS_REFRESH_TOKEN`           | _Written by the callback; rotated by the server_ | Current refresh token. Intuit **rotates** it — the server re-persists the new one after any API call that refreshed. Do not edit by hand. |
| `QUICKBOOKS_ACCESS_TOKEN`            | _Server-managed_                                 | Cached access token (~1 h lifetime), persisted so all server instances reuse it instead of refreshing per call.                           |
| `QUICKBOOKS_ACCESS_TOKEN_EXPIRES_AT` | _Server-managed_                                 | ISO expiry of the cached access token; refreshed at a <2 min margin.                                                                      |

Only the first two (plus `QUICKBOOKS_BASE_URL` for production) need to exist
before running the connect flow; the rest are populated automatically.

> **If the connection ever "bricks"** (e.g. the refresh token expired after
> ~100 days of disuse, or Intuit invalidated it), API calls will fail with
> token errors — simply re-run the connect flow below; it overwrites the
> realm id and token set.

---

## 3. Connect flow (OAuth)

> **Preferred: use the admin UI.** The admin app has a **QuickBooks** tab
> (Project → QuickBooks, `/admin/quickbooks` —
> `packages/app/src/admin/QuickBooksPage.tsx`) that covers §§2–3 and §5:
> enter the client id/secret and environment, click **Connect to QuickBooks**
> (opens the Intuit authorize URL), and run **Pull pricing now** once
> connected. It shows the exact redirect URI to register in the Intuit portal
> and the current connection status. Make sure you are logged into the
> **clinic data project** (FHIR R4) — the page configures the current project.
> The curl flow below remains valid as the headless fallback.

Routes live in `packages/server/src/accounting/routes.ts`, mounted at
`/accounting/quickbooks/` (reachable both with and without the `/api` prefix).

1. As a **project admin** (the route enforces `verifyProjectAdmin`), call:

   ```bash
   curl -H "Authorization: Bearer $ADMIN_ACCESS_TOKEN" \
     "https://app.premierhealthcentres.com/api/accounting/quickbooks/connect"
   ```

   The response is JSON — **not** a redirect (non-FHIR authenticated routes
   are bearer-authenticated, so the server cannot 302 your browser):

   ```json
   { "authorizeUrl": "https://appcenter.intuit.com/connect/oauth2?client_id=..." }
   ```

2. Open `authorizeUrl` in a browser **within 10 minutes** (the signed `state`
   parameter expires). Sign in to Intuit and pick the QBO company (the sandbox
   company when testing) on the consent screen.

3. Intuit redirects the browser to the public callback
   (`…/accounting/quickbooks/callback`), which validates the state, exchanges
   the code, persists `QUICKBOOKS_REALM_ID` + the token set into the project
   secrets, and renders **“QuickBooks connected — This project is now
   connected to QuickBooks company `<realmId>`.”**

4. Verify in **admin app → Project → Secrets** that `QUICKBOOKS_REALM_ID`,
   `QUICKBOOKS_REFRESH_TOKEN`, `QUICKBOOKS_ACCESS_TOKEN`, and
   `QUICKBOOKS_ACCESS_TOKEN_EXPIRES_AT` now exist.

---

## 4. Wire the sync bots (two Subscriptions)

The push triggers are Medplum **Subscriptions** driving the premierhealth QBO
bots (`examples/medplum-demo-bots/src/premierhealth/`). The bots stay thin:
all QBO access lives server-side in the `Invoice/$qbo-sync` operation, because
Intuit refresh tokens rotate and must be re-persisted into project secrets —
which bots cannot do. The bots resolve the affected Invoice and call the
operation.

Deploy the bots with the authenticated `@medplum/cli` (same procedure as the
messaging bots — see `examples/medplum-demo-bots/src/premierhealth/SETUP.md`):

```bash
cd examples/medplum-demo-bots
npm run build
npx medplum bot create premierhealth-quickbooks-sync-invoice
npx medplum bot create premierhealth-quickbooks-sync-payment
# later code changes: npx medplum bot deploy <name>
```

Then create the two Subscriptions (once):

**Invoice push — fires when an Invoice reaches `balanced`** (the status set by
`balanceInvoice` in `packages/server/src/payments/routes.ts` once payments
cover the total):

```json
{
  "resourceType": "Subscription",
  "status": "active",
  "reason": "Push balanced Invoices to QuickBooks Online",
  "criteria": "Invoice?status=balanced",
  "channel": { "type": "rest-hook", "endpoint": "Bot/{quickbooks-sync-invoice botId}" }
}
```

**Payment push — fires when a PaymentReconciliation settles.** Both rails
(Stripe webhook and pawaPay callback) mark settled reconciliations
`status = active` / `outcome = complete`:

```json
{
  "resourceType": "Subscription",
  "status": "active",
  "reason": "Push settled payments to QuickBooks Online",
  "criteria": "PaymentReconciliation?status=active",
  "channel": { "type": "rest-hook", "endpoint": "Bot/{quickbooks-sync-payment botId}" }
}
```

Both paths converge on `POST /fhir/R4/Invoice/{id}/$qbo-sync`, which is
**idempotent** (identifier-guarded — see §6), so overlapping or repeated
firings are harmless: an already-pushed invoice is skipped and only
not-yet-pushed payments are recorded.

---

## 5. Initial pricing pull (`$qbo-pull-pricing`)

QBO is the source of truth for service pricing. Pull the QBO Item list into
the EHR service catalog:

```bash
curl -X POST -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://app.premierhealthcentres.com/api/fhir/R4/\$qbo-pull-pricing"
```

Response (`Parameters`): `created`, `updated`, and `total` counts.

For each QBO Item it **upserts one `ChargeItemDefinition`** (matched by the
stored QBO item identifier — safe to re-run):

| ChargeItemDefinition field           | Value                                                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `identifier`                         | system `https://quickbooks.intuit.com/itemId`, value = the QBO Item id (the idempotency key)              |
| `url` (canonical)                    | `https://premierhealth.cm/fhir/ChargeItemDefinition/qbo-item-{Id}` (stable, derived from the QBO Item id) |
| `status`                             | `active`                                                                                                  |
| `title` / `description`              | QBO Item `Name` / `Description`                                                                           |
| `propertyGroup[0].priceComponent[0]` | type `base`, `UnitPrice` in **XAF**                                                                       |

Charge capture then maps invoice lines to QBO Items through
`ChargeItem.definitionCanonical` → that `ChargeItemDefinition` → its QBO item
identifier. Lines whose ChargeItem has no mapped item fall back to a default
**“Healthcare Services”** Service item, which the server finds or creates in
QBO on first use (posted against the company's first Income account).

Re-run the pull whenever the finance team changes prices in QBO (an admin can
trigger it on demand; a scheduled pull bot is planned in Phase 3).

---

## 6. What `$qbo-sync` does (reference)

`POST /fhir/R4/Invoice/{id}/$qbo-sync`
(`packages/server/src/fhir/operations/qbosync.ts`) — requires the Invoice to be
**`balanced`**, then:

1. **Patient → QBO Customer** — reuses the id stored in `Patient.identifier`
   (system `https://quickbooks.intuit.com/customerId`); else looks up QBO by
   the deterministic DisplayName `“<name> (<first-8-of-patient-id>)”`; else
   creates the Customer — and writes the id back onto the Patient.
2. **Invoice push** — skipped if the Invoice already carries a
   `https://quickbooks.intuit.com/invoiceId` identifier. Lines come from
   `Invoice.lineItem` (amounts in major units — XAF passes straight through);
   `DocNumber` = the FHIR Invoice id (truncated to QBO's 21-char limit).
3. **Payment push** — every settled (`status = active`) PaymentReconciliation
   referencing this Invoice and lacking a
   `https://quickbooks.intuit.com/paymentId` identifier gets a QBO Payment
   applied to the QBO Invoice, posted in the **invoice currency (XAF)** from
   `detail[0].amount` (Stripe Adaptive Pricing settled-currency amounts stay
   metadata).
4. Rotated OAuth tokens are persisted even if the sync failed.

Out parameters: `qboInvoiceId`, `qboCustomerId`, `paymentsSynced`.

---

## 7. Test-drive checklist (QBO sandbox)

Run end-to-end against the sandbox before touching production keys.

1. **Prep:** Development keys in `QUICKBOOKS_CLIENT_ID` /
   `QUICKBOOKS_CLIENT_SECRET`; leave `QUICKBOOKS_BASE_URL` unset (sandbox is
   the default); sandbox redirect URI registered in the Intuit app.
2. **Connect** (§3) picking the sandbox company; confirm the “QuickBooks
   connected” page and the four written secrets.
3. **Pricing pull** (§5): `POST /fhir/R4/$qbo-pull-pricing` → `total` matches
   the sandbox company's Item list (sandbox companies ship with sample Items);
   spot-check one `ChargeItemDefinition` (title, XAF base price, `itemId`
   identifier). Re-run → all `updated`, `created = 0`, no duplicates.
4. **Balanced invoice:** create a test Patient and Invoice and pay it through
   a normal rail (Stripe test mode / pawaPay sandbox) so the webhook settles
   the PaymentReconciliation (`status active` / `outcome complete`) and
   `balanceInvoice` flips the Invoice to `balanced`.
5. **Sync fires** (via the Subscription + bot, or call
   `POST /fhir/R4/Invoice/{id}/$qbo-sync` directly). In the **QBO sandbox UI**
   (Sales → Invoices / Customers) verify: a Customer named
   `“<patient name> (<id-prefix>)”`, an Invoice with `DocNumber` = the FHIR
   Invoice id (first 21 chars) and the expected XAF lines, and a Payment
   applied — invoice shows **PAID**.
6. **Write-backs:** the Patient, Invoice, and PaymentReconciliation now carry
   `quickbooks.intuit.com/customerId` / `invoiceId` / `paymentId`
   identifiers.
7. **Idempotency — rerun `$qbo-sync`** on the same Invoice: returns the same
   `qboInvoiceId`, `paymentsSynced = 0`, and **no** duplicate Customer,
   Invoice, or Payment appears in QBO.
8. **Unmapped-line fallback:** sync an invoice whose ChargeItem has no QBO
   mapping → a “Healthcare Services” Service item appears in QBO and carries
   the line.
9. **Token rotation:** after the calls above, confirm
   `QUICKBOOKS_REFRESH_TOKEN` / `QUICKBOOKS_ACCESS_TOKEN_EXPIRES_AT` in the
   project secrets were updated by the server (they change whenever a refresh
   happened).

**Production switch:** production keys into the two credential secrets, set
`QUICKBOOKS_BASE_URL=https://quickbooks.api.intuit.com`, register the
production redirect URI, re-run the connect flow against the real company —
_only after the VALIDATE-FIRST blocker at the top is resolved._ Also make sure
the QBO **Stripe connector stays disabled** for this company: the EHR is the
single orchestrator for both card and mobile-money postings (design doc §7).

---

## 8. Known limitations

- **Concurrent token-refresh persist race** — two overlapping QBO calls that
  both refresh the access token each persist their rotated token set, and the
  write is last-writer-wins (`persistQuickBooksTokens` re-reads the Project but
  does not lock). Benign within Intuit's ~24 h refresh-token rotation window at
  single-clinic call volume; add a Redis lock or a `versionId`-precondition
  persist when volume grows.
