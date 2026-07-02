# Card Payments (Stripe) — Release Checklist

The card-payment code path is complete and wired: `Invoice/$checkout` operation
([packages/server/src/fhir/operations/checkout.ts](../packages/server/src/fhir/operations/checkout.ts),
registered in [packages/server/src/fhir/routes.ts](../packages/server/src/fhir/routes.ts)), the signed
webhook handler ([packages/server/src/payments/routes.ts](../packages/server/src/payments/routes.ts),
mounted raw-body-first in [packages/server/src/app.ts](../packages/server/src/app.ts)), and the provider
UI ([CardPaymentPanel](../examples/medplum-provider/src/components/billing/CardPaymentPanel.tsx) inside
[PaymentCollection](../examples/medplum-provider/src/components/billing/PaymentCollection.tsx)).
Releasing it is configuration + verification, not code.

## 1. Stripe dashboard (one-time)

- [ ] Create/confirm the Stripe account for Premier Health Centers.
- [ ] Enable **Adaptive Pricing** (Settings → Payments) — invoices are priced in XAF; Stripe presents
      and converts to the payer's local currency. The checkout session also requests it explicitly.
- [ ] Create a webhook endpoint pointing at
      `https://app.premierhealthcentres.com/api/payments/stripe/webhook`
      with events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
      `checkout.session.async_payment_failed`, `checkout.session.expired`.
- [ ] Copy the **secret key**, **webhook signing secret**, and **publishable key**.

## 2. Secrets (per environment)

Set either as Medplum **project secrets** (preferred; Admin app → Project → Secrets) or as server
environment variables in Coolify (single-tenant fallback — `getStripeConfig` checks both):

| Secret | Required | Notes |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | yes | `sk_test_…` first, `sk_live_…` at go-live |
| `STRIPE_WEBHOOK_SECRET` | yes | `whsec_…` from the webhook endpoint |
| `STRIPE_PUBLISHABLE_KEY` | no | surfaced to clients when needed |

## 3. Test-mode verification (before go-live)

1. With `sk_test_…` configured, create an Invoice in the provider app and open the patient's
   Payments tab → Card.
2. Complete checkout with test card `4242 4242 4242 4242`.
3. Confirm: Stripe redirects back with `?payment=success`; the webhook fires (Stripe dashboard →
   webhook deliveries shows 200); the `PaymentReconciliation` becomes `active` with the settled
   amount/currency; the Invoice flips to `balanced`; any awaiting-payment Tasks flip to `ready`
   (release-paid-tasks bot).
4. Also test a cancel (back out of checkout) → PaymentReconciliation stays draft/cancelled, Invoice
   unchanged.

## 4. Go-live

- [ ] Swap secrets to live keys; re-create the webhook endpoint in live mode (new `whsec_…`).
- [ ] Merge to `main` **deliberately** — a push to `main` rebuilds the production stack (Coolify).
- [ ] Re-run one real low-value card payment end-to-end after deploy.

## Known limitations

- Single server-level webhook secret: true multi-tenant (per-project Stripe accounts) would need
  per-project webhook endpoints — fine for the current single-clinic deployment.
- The patient-portal success/cancel URLs are currently fixed (`https://premierhealth.cm/pay/…`);
  revisit when the portal ships.
