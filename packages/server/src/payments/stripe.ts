// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Card payment provider abstraction (Stripe Hosted Checkout).
 *
 * Stripe complements the mobile-money rail (pawaPay) for cross-border and card
 * payers: an Invoice is denominated in XAF, but a foreign payer can settle in
 * their own presentment currency (USD/EUR/GBP) on Stripe's hosted checkout page.
 *
 * Like {@link ./pawapay}, this module exposes a small provider surface so the
 * Invoice `$checkout` operation and the webhook handler never depend on the SDK
 * directly. Every checkout is keyed by a server-generated `sessionRef` UUID,
 * which is the only thing we trust from the (signed) webhook body.
 */
import type { Project } from '@medplum/fhirtypes';
import Stripe from 'stripe';

/** Connection settings resolved from project secrets. */
export interface StripeConfig {
  /** Stripe secret API key (project secret STRIPE_SECRET_KEY). */
  secretKey: string;
  /** Webhook signing secret used to verify webhook payloads (STRIPE_WEBHOOK_SECRET). */
  webhookSecret: string;
  /** Publishable key, surfaced to the client when needed (STRIPE_PUBLISHABLE_KEY). */
  publishableKey?: string;
}

/** A request to create a Stripe Hosted Checkout session. */
export interface CheckoutRequest {
  /** Idempotency key / server-generated correlation UUID (Stripe client_reference_id). */
  sessionRef: string;
  /**
   * The authoritative invoice amount (always XAF for PHC). The Stripe line item is
   * priced directly in this currency; Stripe's Adaptive Pricing presents and
   * converts it to the payer's local currency at Stripe's own FX rate. We never
   * compute FX ourselves — the amount the payer is actually charged comes back on
   * the completed session (amount_total + currency).
   */
  invoiceAmount: { value: number; currency: string };
  /** Optional payer email, pre-filled on the checkout page and used for receipts. */
  payerEmail?: string;
  /** URL Stripe redirects to after a successful payment. */
  successUrl: string;
  /** URL Stripe redirects to if the payer cancels. */
  cancelUrl: string;
  /** Line-item description shown on the checkout page. */
  description: string;
  /** Arbitrary key/value metadata echoed back on the webhook (e.g. project/invoice ids). */
  metadata: Record<string, string>;
}

/** Normalised result of creating a checkout session. */
export interface CheckoutResult {
  /** Stripe checkout session id (cs_...). */
  sessionId: string;
  /** Hosted checkout URL to redirect the payer to. */
  url: string;
  /** Raw Stripe session object, for auditing/debugging. */
  raw: unknown;
}

/** Identifier system correlating a Stripe checkout session with its FHIR resources. */
export const STRIPE_CHECKOUT_SESSION_SYSTEM = 'https://stripe.com/checkout/session';
/** Identifier system for the server-generated checkout correlation UUID. */
export const STRIPE_SESSION_REF_SYSTEM = 'https://premierhealth.cm/stripe/sessionRef';

/**
 * ISO 4217 currencies Stripe treats as zero-decimal: the amount is already in the
 * smallest unit, so it must NOT be multiplied by 100. XAF (Central African CFA
 * franc) is the important one for PHC. See
 * https://docs.stripe.com/currencies#zero-decimal.
 */
const STRIPE_ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);

/**
 * Converts a major-unit amount to the integer minor units Stripe expects.
 * Zero-decimal currencies (e.g. XAF) are passed through unrounded-up; standard
 * two-decimal currencies (USD/EUR/GBP) are multiplied by 100.
 * @param amount - The amount in major units.
 * @param currency - The ISO 4217 currency code.
 * @returns The integer amount in Stripe minor units.
 */
export function toStripeMinorUnits(amount: number, currency: string): number {
  if (STRIPE_ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase())) {
    return Math.round(amount);
  }
  return Math.round(amount * 100);
}

/**
 * Inverse of {@link toStripeMinorUnits}: converts a Stripe minor-unit amount back
 * to major units, used to record what the payer was actually charged (in whatever
 * currency Stripe's Adaptive Pricing presented).
 * @param minor - The integer amount in Stripe minor units.
 * @param currency - The ISO 4217 currency code.
 * @returns The amount in major units.
 */
export function fromStripeMinorUnits(minor: number, currency: string): number {
  if (STRIPE_ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase())) {
    return minor;
  }
  return minor / 100;
}

/**
 * Resolves the Stripe webhook signing secret for a project: prefer the project's
 * STRIPE_WEBHOOK_SECRET secret, fall back to the server environment variable
 * (single-tenant on-prem deployments). This is the same lookup `getStripeConfig`
 * uses, so a project configured purely via project secrets verifies webhooks too.
 * @param project - The project the webhook event belongs to, when known.
 * @returns The webhook signing secret, or undefined when not configured anywhere.
 */
export function resolveStripeWebhookSecret(project: Project | undefined): string | undefined {
  return (
    project?.secret?.find((s) => s.name === 'STRIPE_WEBHOOK_SECRET')?.valueString ?? process.env.STRIPE_WEBHOOK_SECRET
  );
}

/**
 * Extracts the projectId metadata (stamped by the Invoice `$checkout` operation)
 * from a raw, UNVERIFIED Stripe webhook body. The value is used only to look up
 * which project's webhook secret to verify the signature with — nothing else is
 * read from the body before the signature is verified.
 * @param rawBody - The raw webhook request body (Buffer or string).
 * @returns The projectId metadata value, or undefined when absent/unparseable.
 */
export function extractWebhookProjectId(rawBody: Buffer | string | undefined): string | undefined {
  if (!rawBody) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'));
    const projectId = parsed?.data?.object?.metadata?.projectId;
    return typeof projectId === 'string' && projectId ? projectId : undefined;
  } catch {
    return undefined;
  }
}

export interface CardPaymentProvider {
  /** Create a hosted checkout session for the payer. */
  createCheckoutSession(req: CheckoutRequest, config: StripeConfig): Promise<CheckoutResult>;
  /** Fetch the authoritative current state of a checkout session. */
  getSession(sessionId: string, config: StripeConfig): Promise<Stripe.Checkout.Session>;
  /** Verify a webhook payload signature and parse the event. */
  constructWebhookEvent(rawBody: Buffer, signature: string, config: StripeConfig): Stripe.Event;
}

export class StripeProvider implements CardPaymentProvider {
  private client(config: StripeConfig): Stripe {
    return new Stripe(config.secretKey);
  }

  async createCheckoutSession(req: CheckoutRequest, config: StripeConfig): Promise<CheckoutResult> {
    const stripe = this.client(config);
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        // Price in the invoice currency (XAF); let Stripe present + convert to the
        // payer's local currency at Stripe's own FX rate. Defaults to the account's
        // dashboard Adaptive Pricing setting; enabling it here makes the intent explicit.
        adaptive_pricing: { enabled: true },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: req.invoiceAmount.currency.toLowerCase(),
              unit_amount: toStripeMinorUnits(req.invoiceAmount.value, req.invoiceAmount.currency),
              product_data: { name: req.description },
            },
          },
        ],
        success_url: req.successUrl,
        cancel_url: req.cancelUrl,
        client_reference_id: req.sessionRef,
        customer_email: req.payerEmail,
        metadata: req.metadata,
      },
      { idempotencyKey: req.sessionRef }
    );

    if (!session.url) {
      throw new Error('Stripe did not return a checkout URL');
    }
    return { sessionId: session.id, url: session.url, raw: session };
  }

  async getSession(sessionId: string, config: StripeConfig): Promise<Stripe.Checkout.Session> {
    const stripe = this.client(config);
    return stripe.checkout.sessions.retrieve(sessionId);
  }

  constructWebhookEvent(rawBody: Buffer, signature: string, config: StripeConfig): Stripe.Event {
    const stripe = this.client(config);
    return stripe.webhooks.constructEvent(rawBody, signature, config.webhookSecret);
  }
}
