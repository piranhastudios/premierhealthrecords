# Premier Health — Patient Portal (Expo)

A cross-platform (iOS · Android · Web) patient portal for **Premier Health Cameroon**, built with
Expo + React Native and the Medplum FHIR client. It is offline-first, supports diaspora payments, lets
one account holder manage a whole family, and carries a flip **digital ID card with a secure rotating
QR code**.

> Part of the `premierhealthrecords` monorepo. `examples/*` is excluded from the production build
> (`turbo run build --filter=!./examples/*`), so this app never ships in the server/provider images.

## What it does

| Capability | How |
| --- | --- |
| **Offline records** | Curated International Patient Summary (allergies, meds, conditions, immunizations, labs, recent visits) + invoices cached in encrypted SQLite (`src/offline`). Works in airplane mode. |
| **Diaspora & local payments** | pawaPay mobile money (in-country) via `Invoice/$pay`; Stripe Hosted Checkout (international cards) via `Invoice/$checkout`, opened in a WebView. `app/pay/[invoiceId].tsx`. |
| **Family management (hybrid)** | One holder manages dependents as switchable Patient profiles; adult relatives can be invited to claim their own login. `src/hooks/useActiveProfile.tsx`, `app/(tabs)/profile/family.tsx`. |
| **Flip ID card + rotating QR** | Biometric-gated card that flips to a rotating QR used to identify, check in, authorize payment, or grant time-boxed provider access. `src/components/IdCard.tsx`, `src/qr/*`. |
| **Messaging** | Realtime chat over the FHIR `Communication` model (reuses the WhatsApp/email bot bridge). `app/(tabs)/messages`. |
| **Telehealth** | WebRTC call surface (`app/visit/[appointmentId].tsx`) — media wiring is the remaining dev-build step. |

## Architecture

- **Backend**: the existing Medplum FHIR server (`{baseUrl}/fhir/R4`). No new backend.
- **Auth**: OAuth2 PKCE. Web uses `MedplumClient.signInWithRedirect`; native drives PKCE with
  `expo-auth-session` + `expo-crypto` and a tiny `sessionStorage` shim (`src/lib/polyfills.ts`), then
  `processCode`. Tokens live in the device keychain via `ExpoSecureClientStorage` (`src/medplum/storage.ts`).
- **Offline**: `readPatientSummary` (IPS) → bucketed into SQLite; incremental sync by `_lastUpdated`; an
  outbox queues offline writes (bookings, messages) and drains on reconnect. Clinical data is
  server-wins; patient-authored data is queue+retry with idempotency keys. `src/offline/sync.ts`.
- **Rotating QR**: short-lived **server-signed JWS** online (required for pay/grant); **offline TOTP**
  for id/check-in only. The token carries an opaque handle + nonce + expiry — never PHI. `src/qr/*`.
- **Styling**: NativeWind (Tailwind) with PHC brand tokens in `tailwind.config.js` / `src/theme/tokens.ts`
  (warm orange `#EE6A1F` / red `#E0231F` / gold `#F7A91E`, from the PHC logo).

## Prerequisites

- Node 22+, the repo installed from the root (`npm install` at the monorepo root).
- A running Medplum server (this repo's `packages/server`) and a **public PKCE OAuth client** whose
  redirect URIs include `phc://auth/callback` (native) and your web origin + `/callback`.
- For native: Xcode / Android Studio and an **Expo dev build** (see below).

## Configure & run

```bash
# from the monorepo root
npm install

cd examples/patient-portal
# point the app at your server + client
export MEDPLUM_BASE_URL="https://phr.commerce.storefactory.shop/api/"  # test; or http://localhost:8103/
export MEDPLUM_CLIENT_ID="<your-pkce-client-id>"

# Web (fastest to try)
npm run web

# Native — requires a dev build (NOT Expo Go) for SQLCipher, biometrics, camera, WebRTC
npx expo run:ios      # or: npm run ios
npx expo run:android  # or: npm run android
```

> First time on native, build a dev client: `npx expo install expo-dev-client` is already a dep; run
> `eas build --profile development` (see `eas.json`) or `expo run:ios/android` for a local dev build.

If dependency versions drift from the Expo SDK, run `npx expo install --fix`.

## Expo Go vs dev build

Expo Go is only enough for the earliest pure-JS screens. A **dev build is required** for:
- **SQLCipher** (encrypted SQLite at rest) — `src/offline/db.ts` issues `PRAGMA key`; on a stock build
  the pragma is a no-op and the DB is unencrypted (dev only). Wire a SQLCipher-enabled `expo-sqlite`
  build / config plugin for production.
- **expo-local-authentication** (Face ID / fingerprint), **expo-camera**, and **react-native-webrtc**.

## Server endpoints this app calls

Existing: `Invoice/$pay` (pawaPay). Added in this change set:
- `Invoice/$checkout` — Stripe Hosted Checkout session (server: `packages/server/src/payments/stripe.ts`,
  `packages/server/src/fhir/operations/checkout.ts`).
- `Patient/$qr-enroll`, `Patient/$issue-qr`, `Patient/$verify-qr`, `Patient/$grant`,
  `Patient/$invite-family-member`, `Patient/$claim-family-invite` (server: `packages/server/src/fhir/operations/qr.ts`,
  `grant.ts`, `familyinvite.ts`).

**Server secrets required** (Project.secret or env): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`STRIPE_PUBLISHABLE_KEY`, and `QR_SIGNING_KEY` (HMAC key for the QR tokens).

**Cross-border FX** is delegated to Stripe: the Checkout line item is priced in the invoice currency
(XAF) and **Stripe Adaptive Pricing** presents + converts it to the payer's local currency at Stripe's
own rate — enable Adaptive Pricing in the Stripe Dashboard (Settings → Adaptive Pricing). No manual FX
rate config. The amount actually charged is captured from the completed session onto the
`PaymentReconciliation` by the webhook. **Stripe live webhook URL:**
`https://phr.commerce.storefactory.shop/api/payments/stripe/webhook`.

## Security notes

- The QR encodes only an opaque handle + single-use nonce + ~60s expiry. `pay` and `grant` are
  **online-only**; a photographed QR is useless within seconds and reveals no PHI.
- Revealing the QR requires a biometric (`src/qr/biometricGate.ts`).
- Time-boxed provider access (`$grant`) creates a FHIR `Consent` + a temporary `meta.accounts[]` entry
  that a revocation job removes at expiry.

## Project layout

```
app/                 expo-router routes (auth, tabs, pay, visit)
src/medplum/         client factory, secure storage, native PKCE auth
src/hooks/           active-profile (family switching), network status
src/offline/         SQLite schema, repositories, sync engine, outbox
src/qr/              rotating-QR token model, online JWS, offline TOTP, biometrics
src/components/      PHC UI kit + IdCard (flip), QrBadge, banners
src/theme/           PHC design tokens
```

## Builds, CI/CD and crash reporting

### Pipelines

| Workflow | Trigger | Does |
| --- | --- | --- |
| `.github/workflows/mobile-ci.yml` | PR / push touching `examples/patient-portal/**` | `tsc`, `npm run check:native-dupes`, a **release** `expo export` for Android + iOS, and `expo-doctor` as a report |
| `.github/workflows/mobile-release.yml` | Manual (`Actions -> Mobile Release`) or a `portal-v*` tag | `eas build` for the chosen profile; optional `eas submit` |

**`check:native-dupes` is the gate that matters** (`scripts/check-native-dupes.mjs`).
A native module resolved at two different versions is invisible to `tsc` and to
Metro in development, but it links one version natively while bundling the other
in JS — a launch crash on a real device. That is what shipped: `@expo/vector-icons`
declares an open-ended `expo-font: ">=14.0.4"` **peer** range, so npm installed
`expo-font@57.0.0` and hoisted it above the `expo-font@14.0.12` that Expo SDK 54
pins, and autolinking picked the 57. `expo-font` is now both an explicit
dependency here and pinned in the root `package.json` `overrides`, so only one
copy can exist.

`expo-doctor` runs too, but only as a report. Its duplicate check is
all-or-nothing and permanently flags the two copies of `react` (the app's 19.1.0
and `@medplum/react-hooks`' 19.2.5) that `metro.config.js` already collapses to a
single instance, plus patch-level SDK drift — so it cannot gate. Do read it.

The `expo export` step matters for the same reason: it builds the bundle the way
it ships (`__DEV__` false, minified, production module resolution), so a module
that only resolves in the dev server fails in CI instead of on a patient's phone.

`Mobile Release` additionally runs `scripts/check-api-reachable.mjs` before it
spends an EAS build slot: it GETs `{MEDPLUM_BASE_URL}healthcheck` for the chosen
profile and fails on DNS failure, TLS failure or anything that is not a Medplum
healthcheck. The base URL is **baked into the binary**, so getting it wrong means
a reinstall, not a config change — the shipped app pointed at
`https://api.premierhealth.cm/`, a hostname with no DNS record at all. Tick
`skip_api_preflight` on a manual run to build anyway during an infra migration.

Run the checks locally:

    npm run check:api     -- --profile production
    npm run check:sentry  -- --profile production

`check:sentry` exists because **renaming a project in Sentry changes its slug
while the DSN keeps working** — the DSN encodes the numeric project id, which
survives a rename. So nothing looks wrong until the Gradle source-map upload
fails with `One or more projects are invalid`, seven minutes into the build.
Update `SENTRY_PROJECT` in `eas.json` whenever the project is renamed.

### Required secrets

| Where | Name | Needed for |
| --- | --- | --- |
| GitHub repo secret | `EXPO_TOKEN` | every `Mobile Release` run |
| EAS env var (secret) | `SENTRY_AUTH_TOKEN` | source-map upload during the build |
| `eas.json` (not secret) | `PHC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT` | crash reporting + release association |

`EXPO_TOKEN` is the only GitHub secret. Sentry's build-time variables have to be
**EAS** environment variables: the GitHub runner only queues the build, and its
environment is not forwarded to the EAS build worker.

**Sentry is configured** — org `piranha-studios`, project `react-native` (EU
region). The DSN lives in `eas.json` next to the base URL because a DSN is a
public client credential: it ships inside the app by design. `SENTRY_AUTH_TOKEN`
is the only secret, and it is stored as an **EAS environment variable** (secret
visibility, all three environments) because GitHub secrets do not reach the EAS
build worker. `metro.config.js` uses `getSentryExpoConfig` so builds emit the
debug ids Sentry needs to resolve minified frames.

The DSN variable is named `PHC_SENTRY_DSN`, not `SENTRY_DSN`, on purpose: **EAS
Build sets its own `SENTRY_DSN`** during the `READ_APP_CONFIG` phase (Expo's CLI
telemetry DSN), and reading the plain name would silently bake Expo's DSN into
the app and send patient crash reports to Expo's Sentry org.

`app.config.js` only adds the Sentry config plugin when `PHC_SENTRY_DSN` is set,
because the plugin registers a Gradle task that shells out to `sentry-cli`; with
no org configured that task fails and takes the whole Android build down with
`An organization ID or slug is required`. If you ever need to build without
Sentry, unset that variable — do not delete `SENTRY_AUTH_TOKEN` and leave the DSN
in place, or set `SENTRY_DISABLE_AUTO_UPLOAD=true` on the profile.

### What this app deliberately does NOT send

`npx @sentry/wizard` writes a default `Sentry.init` that is wrong for a patient
records app. Its settings were removed on purpose; do not restore them from a
future wizard run:

| Wizard default | Why it is off here |
| --- | --- |
| `sendDefaultPii: true` | Attaches IP address, cookies and user identifiers to every event. |
| `mobileReplayIntegration()` | Session Replay **records the screen** — medical records, the ID card, the QR code. `replaysOnErrorSampleRate: 1` would capture a replay on every error. |
| `feedbackIntegration()` | Adds a user-facing feedback widget nobody designed or translated. |
| `enableLogs: true` | Ships console output, which can carry patient data. |
| `Sentry.init` in `app/_layout.tsx` | Runs only once expo-router has loaded the app — far too late to catch a module-evaluation crash, which is the reason this app has crash reporting at all. |

Initialisation happens in `src/lib/startReporting.ts` (imported first in
`index.ts`) and all events pass through `src/lib/reporting.ts`, which strips FHIR
resource ids and bearer tokens before anything leaves the device.

Store submission is **off** unless you tick `submit` on a manual production run.
The first-ever Play release must be uploaded by hand — Google rejects API
submissions to a track that has never received a build.

### Crash reporting

- `src/lib/reporting.ts` is the only module that touches Sentry. It scrubs FHIR
  resource ids and bearer tokens out of every event before it leaves the device;
  this app handles patient records, so a raw stack trace is not safe to upload.
- It starts from `src/lib/startReporting.ts`, imported **first** in `index.ts`.
  That indirection is deliberate: `import` declarations are hoisted, so a bare
  `initCrashReporting()` call in `index.ts` would run *after* `expo-router/entry`
  had already loaded the app — too late for a crash during module evaluation.
- `app/_layout.tsx` exports an `ErrorBoundary`. Release builds have no red box,
  so without one a render-time exception unmounts the tree and the app simply
  closes with no explanation.

### Build profiles

`eas.json` profiles differ in more than signing — each points at its own server:

All three profiles hit the **same server**; live and test are separated by
`MEDPLUM_PROJECT_ID`, not by hostname:

| Profile | Android artifact | Project | `MEDPLUM_PROJECT_ID` |
| --- | --- | --- | --- |
| `development` | APK, internal | Douala (dev) | `c4c16ab3-…` |
| `preview` | APK, internal | Douala (dev) | `c4c16ab3-…` |
| `production` | AAB, store | Douala (live) | `161452d9-…` |

**The Medplum API is reachable only at `https://phr.commerce.storefactory.shop/api/`.**
Traefik on the `sf-prod-1` host routes by hostname:

| Host | Container |
| --- | --- |
| `phr.commerce.storefactory.shop` + `PathPrefix(/api)` | `phr-server` (the API) |
| `phr.commerce.storefactory.shop` | `phr-provider` (provider web app) |
| `phr-admin.commerce.storefactory.shop` | `phr-app` (Medplum admin console) |
| `premier-health-centres.commerce.storefactory.shop` | `premier-health-centres-medusa` — a **Medusa storefront**, not the EHR |

Two traps that have already cost a release:

- `premier-health-centres.commerce.storefactory.shop` looks like the right host
  but is that client's e-commerce store. It answers on 443 with a valid
  certificate and 404s every Medplum path.
- `app.premierhealthcentres.com` has **no Traefik router at all**, so it serves
  the Traefik default self-signed certificate. Android rejects an untrusted
  certificate outright, so a build pointed there cannot make a single request.

`npm run check:api -- --profile <name>` catches both.

## Known limitations / next steps

- **Brand assets** are PHC-orange placeholders (`assets/*.png`); drop in the real logo and re-confirm
  exact hex.
- **WebRTC** media (peer connection + signaling) is stubbed — UI + lifecycle are in place.
- **Tests** use `jest-expo` (not the repo's vitest, which can't drive RN). None are written yet.
- The app is excluded from the repo's root `tsc`/`build`; typecheck it locally with `npm run typecheck`
  after `npx expo install` so Expo's generated types are present.
