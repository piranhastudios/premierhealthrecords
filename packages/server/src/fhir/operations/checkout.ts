// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { allOk, badRequest, createReference, getReferenceString } from '@medplum/core';
import type { FhirRequest, FhirResponse } from '@medplum/fhir-router';
import type {
  Invoice,
  Money,
  OperationDefinition,
  ParametersParameter,
  PaymentReconciliation,
  Project,
} from '@medplum/fhirtypes';
import { randomUUID } from 'node:crypto';
import { getConfig } from '../../config/loader';
import { getAuthenticatedContext } from '../../context';
import type { StripeConfig } from '../../payments/stripe';
import {
  resolveStripeWebhookSecret,
  STRIPE_CHECKOUT_SESSION_SYSTEM,
  STRIPE_SESSION_REF_SYSTEM,
  StripeProvider,
} from '../../payments/stripe';
import { parseInputParameters } from './utils/parameters';

const operation: OperationDefinition = {
  resourceType: 'OperationDefinition',
  id: 'invoice-checkout',
  url: 'https://medplum.com/fhir/OperationDefinition/invoice-checkout',
  name: 'checkout',
  status: 'active',
  kind: 'operation',
  code: 'checkout',
  resource: ['Invoice'],
  system: false,
  type: false,
  instance: true,
  parameter: [
    {
      name: 'method',
      use: 'in',
      min: 0,
      max: '1',
      type: 'string',
      documentation: 'Checkout method; currently only "card" (Stripe Hosted Checkout). Defaults to "card".',
    },
    {
      name: 'currency',
      use: 'in',
      min: 0,
      max: '1',
      type: 'string',
      documentation: 'Presentment currency the payer is charged in, e.g. "USD". Defaults to the Invoice currency.',
    },
    {
      name: 'successUrl',
      use: 'in',
      min: 1,
      max: '1',
      type: 'string',
      documentation: 'URL Stripe redirects to after a successful payment.',
    },
    {
      name: 'cancelUrl',
      use: 'in',
      min: 1,
      max: '1',
      type: 'string',
      documentation: 'URL Stripe redirects to if the payer cancels.',
    },
    {
      name: 'payerEmail',
      use: 'in',
      min: 0,
      max: '1',
      type: 'string',
      documentation: 'Optional payer email, pre-filled on the checkout page and used for receipts.',
    },
    {
      name: 'amount',
      use: 'in',
      min: 0,
      max: '1',
      type: 'Money',
      documentation: 'Optional amount override; defaults to the Invoice total (XAF).',
    },
    { name: 'checkoutUrl', use: 'out', min: 1, max: '1', type: 'string' },
    { name: 'sessionId', use: 'out', min: 1, max: '1', type: 'string' },
    { name: 'paymentReconciliation', use: 'out', min: 1, max: '1', type: 'Reference' },
  ],
};

interface CheckoutParameters {
  method?: string;
  currency?: string;
  successUrl: string;
  cancelUrl: string;
  payerEmail?: string;
  amount?: Money;
}

const DEFAULT_CURRENCY = 'XAF';

/**
 * Resolves Stripe connection settings from project secrets.
 * @param project - The current project.
 * @returns The resolved Stripe config.
 */
export function getStripeConfig(project: Project): StripeConfig {
  // Prefer a per-project secret; fall back to a server env var for single-tenant
  // on-prem deployments (e.g. set STRIPE_SECRET_KEY in the Coolify/Docker env).
  const secretKey =
    project.secret?.find((s) => s.name === 'STRIPE_SECRET_KEY')?.valueString ?? process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      'Stripe secret key not configured (set the STRIPE_SECRET_KEY project secret or environment variable)'
    );
  }
  const webhookSecret = resolveStripeWebhookSecret(project);
  if (!webhookSecret) {
    throw new Error(
      'Stripe webhook secret not configured (set the STRIPE_WEBHOOK_SECRET project secret or environment variable)'
    );
  }
  const publishableKey =
    project.secret?.find((s) => s.name === 'STRIPE_PUBLISHABLE_KEY')?.valueString ?? process.env.STRIPE_PUBLISHABLE_KEY;
  return { secretKey, webhookSecret, publishableKey };
}

// Reference the webhook URL config so deployers know where Stripe should post.
// baseUrl already includes the `/api/` mount (e.g. https://app.premierhealthcentres.com/api/),
// so use a path RELATIVE to it — mirroring getPawaPayCallbackUrl — to avoid a double `/api/`.
// Resolves to `${baseUrl}payments/stripe/webhook`, e.g.
//   https://app.premierhealthcentres.com/api/payments/stripe/webhook
export function getStripeWebhookUrl(): string {
  return new URL('payments/stripe/webhook', getConfig().baseUrl).toString();
}

/**
 * Handles the Invoice `$checkout` operation: collect the invoice amount from the
 * patient via Stripe Hosted Checkout (card / cross-border payer).
 *
 * FX is delegated entirely to Stripe: the line item is priced in the invoice
 * currency (XAF) and Stripe's Adaptive Pricing presents + converts it to the
 * payer's local currency at Stripe's own rate. We never compute a rate ourselves;
 * the amount actually charged comes back on the completed session and is recorded
 * on the PaymentReconciliation by the webhook.
 *
 * Flow: read the Invoice -> create a draft PaymentReconciliation keyed by a new
 * sessionRef -> create the Stripe checkout session. Stripe confirms the outcome
 * asynchronously via the webhook handled in `payments/routes.ts`, which finalizes
 * the PaymentReconciliation and balances the Invoice.
 * @param req - The FHIR request (instance-level on Invoice).
 * @returns The FHIR response with checkoutUrl, sessionId, and the PaymentReconciliation reference.
 */
export async function invoiceCheckoutHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const { id } = req.params;

  let config: StripeConfig;
  try {
    config = getStripeConfig(ctx.project);
  } catch (error) {
    return [badRequest((error as Error).message)];
  }

  const invoice = await ctx.repo.readResource<Invoice>('Invoice', id);
  const params = parseInputParameters<CheckoutParameters>(operation, req);

  const amount: Money | undefined = params.amount ?? invoice.totalGross ?? invoice.totalNet;
  if (amount?.value === undefined) {
    return [badRequest('No amount to charge: provide an amount or set Invoice.totalGross')];
  }
  const invoiceCurrency: string = amount.currency ?? DEFAULT_CURRENCY;

  if (!params.successUrl || !params.cancelUrl) {
    return [badRequest('successUrl and cancelUrl are required')];
  }

  const sessionRef = randomUUID();
  const now = new Date().toISOString();

  // Record the in-flight collection before calling out, so the signed webhook can
  // always correlate the session back to this Invoice. paymentAmount starts as the
  // XAF invoice amount; the webhook overwrites it with what Stripe actually charged
  // (the Adaptive-Pricing-converted amount + currency).
  const paymentReconciliation = await ctx.repo.createResource<PaymentReconciliation>({
    resourceType: 'PaymentReconciliation',
    status: 'draft',
    created: now,
    paymentDate: now.slice(0, 10), // FHIR `date` (YYYY-MM-DD), not a dateTime
    paymentAmount: { value: amount.value, currency: invoiceCurrency } as Money,
    outcome: 'queued',
    identifier: [{ system: STRIPE_SESSION_REF_SYSTEM, value: sessionRef }],
    detail: [
      {
        type: { coding: [{ code: 'card', display: 'Card payment (Stripe)' }] },
        request: createReference(invoice),
        amount: { value: amount.value, currency: invoiceCurrency } as Money,
      },
    ],
  });

  const provider = new StripeProvider();
  let sessionId: string;
  let checkoutUrl: string;
  try {
    const result = await provider.createCheckoutSession(
      {
        sessionRef,
        invoiceAmount: { value: amount.value, currency: invoiceCurrency },
        payerEmail: params.payerEmail,
        successUrl: params.successUrl,
        cancelUrl: params.cancelUrl,
        description: `Premier Health invoice ${invoice.id}`,
        metadata: {
          projectId: ctx.project.id,
          invoiceId: invoice.id,
          sessionRef,
        },
      },
      config
    );
    sessionId = result.sessionId;
    checkoutUrl = result.url;
  } catch (error) {
    // Mark the attempt failed but keep the record for audit.
    await ctx.repo.updateResource({
      ...paymentReconciliation,
      status: 'cancelled',
      outcome: 'error',
      disposition: (error as Error).message,
    });
    return [badRequest((error as Error).message)];
  }

  // Add the Stripe session id as a second identifier so the webhook can resolve the
  // PaymentReconciliation by either the sessionRef or the session id.
  await ctx.repo.updateResource({
    ...paymentReconciliation,
    identifier: [
      ...(paymentReconciliation.identifier ?? []),
      { system: STRIPE_CHECKOUT_SESSION_SYSTEM, value: sessionId },
    ],
  });

  const out: ParametersParameter[] = [
    { name: 'checkoutUrl', valueString: checkoutUrl },
    { name: 'sessionId', valueString: sessionId },
    { name: 'paymentReconciliation', valueReference: { reference: getReferenceString(paymentReconciliation) } },
  ];
  return [allOk, { resourceType: 'Parameters', parameter: out }];
}
