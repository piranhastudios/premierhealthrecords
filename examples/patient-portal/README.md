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
export MEDPLUM_BASE_URL="https://api.premierhealth.cm/"   # or http://localhost:8103/
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
`https://app.premierhealthcentres.com/api/payments/stripe/webhook`.

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

## Known limitations / next steps

- **Brand assets** are PHC-orange placeholders (`assets/*.png`); drop in the real logo and re-confirm
  exact hex.
- **WebRTC** media (peer connection + signaling) is stubbed — UI + lifecycle are in place.
- **Tests** use `jest-expo` (not the repo's vitest, which can't drive RN). None are written yet.
- The app is excluded from the repo's root `tsc`/`build`; typecheck it locally with `npm run typecheck`
  after `npx expo install` so Expo's generated types are present.
