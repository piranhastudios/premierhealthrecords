// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Operator } from '@medplum/core';
import type { Invoice, Money, PaymentReconciliation, Project, Reference } from '@medplum/fhirtypes';
import type { Request, Response } from 'express';
import { Router } from 'express';
import { getStripeConfig } from '../fhir/operations/checkout';
import { getPawaPayConfig } from '../fhir/operations/pay';
import { getGlobalSystemRepo } from '../fhir/repo';
import { globalLogger } from '../logger';
import { PAWAPAY_DEPOSIT_SYSTEM, PawaPayProvider } from './pawapay';
import {
  extractWebhookProjectId,
  fromStripeMinorUnits,
  resolveStripeWebhookSecret,
  STRIPE_CHECKOUT_SESSION_SYSTEM,
  STRIPE_SESSION_REF_SYSTEM,
  StripeProvider,
} from './stripe';

/**
 * Public callback for pawaPay deposit status notifications.
 *
 * pawaPay POSTs here when a collection settles. The callback is unauthenticated,
 * so we never trust its body for the outcome: we correlate the depositId back to
 * our PaymentReconciliation, then re-fetch the authoritative status from pawaPay
 * using that project's own token before mutating anything. Every payment is
 * keyed by a server-generated UUID, which is the only thing we read from the body.
 * @param req - The request object.
 * @param res - The response object.
 */
export const pawaPayCallbackHandler = async (req: Request, res: Response): Promise<void> => {
  const depositId: string | undefined = req.body?.depositId;
  if (!depositId) {
    res.status(400).json({ received: false, error: 'Missing depositId' });
    return;
  }

  try {
    const systemRepo = getGlobalSystemRepo();
    const reconciliation = await systemRepo.searchOne<PaymentReconciliation>({
      resourceType: 'PaymentReconciliation',
      filters: [{ code: 'identifier', operator: Operator.EQUALS, value: `${PAWAPAY_DEPOSIT_SYSTEM}|${depositId}` }],
    });

    if (!reconciliation) {
      globalLogger.warn('[pawaPay] Callback for unknown depositId', { depositId });
      res.status(200).json({ received: false });
      return;
    }

    // Already finalized (idempotent against pawaPay retries).
    if (reconciliation.status !== 'draft') {
      res.status(200).json({ received: true, status: reconciliation.outcome });
      return;
    }

    const projectId = reconciliation.meta?.project;
    if (!projectId) {
      res.status(200).json({ received: false });
      return;
    }
    const project = await systemRepo.readResource<Project>('Project', projectId);
    const config = getPawaPayConfig(project);

    // Re-fetch authoritative status; do not trust the callback body.
    const authoritative = await new PawaPayProvider().getDeposit(depositId, config);
    const status = authoritative?.status ?? 'UNKNOWN';

    if (status === 'COMPLETED') {
      await systemRepo.updateResource<PaymentReconciliation>({
        ...reconciliation,
        status: 'active',
        outcome: 'complete',
        disposition: 'Payment completed',
      });
      await balanceInvoice(systemRepo, reconciliation);
    } else if (status === 'FAILED' || status === 'REJECTED') {
      await systemRepo.updateResource<PaymentReconciliation>({
        ...reconciliation,
        status: 'cancelled',
        outcome: 'error',
        disposition: authoritative?.failureReason ?? status,
      });
    } // else still in flight — leave as draft for a later callback.

    res.status(200).json({ received: true, status });
  } catch (error) {
    globalLogger.error('[pawaPay] Callback processing error', { error, depositId });
    res.status(200).json({ received: false });
  }
};

/** Stripe events that indicate a checkout/payment has succeeded. */
const STRIPE_PAID_EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'payment_intent.succeeded',
]);

/** Stripe events that indicate a checkout/payment has failed or expired. */
const STRIPE_FAILED_EVENTS = new Set([
  'checkout.session.expired',
  'checkout.session.async_payment_failed',
  'payment_intent.payment_failed',
]);

/**
 * Public webhook for Stripe checkout/payment events.
 *
 * Stripe POSTs here when a hosted-checkout session changes state. The body is
 * verified against the Stripe signature (so, unlike the pawaPay callback, the
 * event itself is trustworthy) — but we still re-fetch the authoritative session
 * from Stripe before marking anything paid, and correlate every event back to a
 * draft PaymentReconciliation keyed by the server-generated sessionRef.
 *
 * NOTE on multi-tenancy: the signing secret is resolved per event. The `$checkout`
 * operation stamps the project id into the session metadata, so the (unverified)
 * body is parsed ONLY to pick which project's STRIPE_WEBHOOK_SECRET secret to
 * verify the signature with, falling back to the server-level env var when the
 * project is absent or unresolvable. Nothing else is trusted before verification.
 *
 * This handler must receive the RAW request body (a Buffer) for signature
 * verification, so it is registered in `app.ts` with `express.raw()` BEFORE the
 * global JSON body parser — it is intentionally NOT mounted on `paymentsRouter`.
 * @param req - The request object (req.body is a raw Buffer).
 * @param res - The response object.
 */
export const stripeWebhookHandler = async (req: Request, res: Response): Promise<void> => {
  const signature = req.headers['stripe-signature'];
  if (!signature || typeof signature !== 'string') {
    res.status(400).json({ received: false, error: 'Missing Stripe signature' });
    return;
  }

  // Resolve the signing secret BEFORE verification: `$checkout` stamps the project id
  // into the session metadata, so a project configured purely via project secrets (no
  // server env var) still gets its webhooks verified. The unverified body is parsed
  // only to pick the secret; when the project is absent or unresolvable we fall back
  // to the env secret.
  let webhookProject: Project | undefined;
  const webhookProjectId = extractWebhookProjectId(req.body as Buffer);
  if (webhookProjectId) {
    try {
      webhookProject = await getGlobalSystemRepo().readResource<Project>('Project', webhookProjectId);
    } catch {
      // Unknown/unreadable project — fall back to the env secret below.
    }
  }
  const webhookSecret = resolveStripeWebhookSecret(webhookProject);
  if (!webhookSecret) {
    res.status(400).json({ received: false, error: 'Missing Stripe webhook secret' });
    return;
  }

  // Verify the signature against the raw body. A failure here is the only case that
  // returns a non-200, so Stripe retries on genuine tampering/misconfiguration.
  let event;
  try {
    event = new StripeProvider().constructWebhookEvent(req.body as Buffer, signature, {
      secretKey: process.env.STRIPE_SECRET_KEY ?? '',
      webhookSecret,
    });
  } catch (error) {
    globalLogger.warn('[stripe] Webhook signature verification failed', { error: (error as Error).message });
    res.status(400).json({ received: false, error: 'Invalid signature' });
    return;
  }

  // We only act on checkout/payment events; everything else is acknowledged.
  const isPaid = STRIPE_PAID_EVENTS.has(event.type);
  const isFailed = STRIPE_FAILED_EVENTS.has(event.type);
  if (!isPaid && !isFailed) {
    res.status(200).json({ received: true, ignored: event.type });
    return;
  }

  // Extract the session id + sessionRef (client_reference_id) from the event object.
  const object = event.data.object as {
    id?: string;
    client_reference_id?: string;
    metadata?: Record<string, string> | null;
  };
  const sessionId = object.id;
  const sessionRef = object.client_reference_id ?? object.metadata?.sessionRef;

  try {
    const systemRepo = getGlobalSystemRepo();
    let reconciliation = sessionRef
      ? await systemRepo.searchOne<PaymentReconciliation>({
          resourceType: 'PaymentReconciliation',
          filters: [
            { code: 'identifier', operator: Operator.EQUALS, value: `${STRIPE_SESSION_REF_SYSTEM}|${sessionRef}` },
          ],
        })
      : undefined;

    if (!reconciliation && sessionId) {
      reconciliation = await systemRepo.searchOne<PaymentReconciliation>({
        resourceType: 'PaymentReconciliation',
        filters: [
          { code: 'identifier', operator: Operator.EQUALS, value: `${STRIPE_CHECKOUT_SESSION_SYSTEM}|${sessionId}` },
        ],
      });
    }

    if (!reconciliation) {
      globalLogger.warn('[stripe] Webhook for unknown session', { sessionId, sessionRef, type: event.type });
      res.status(200).json({ received: false });
      return;
    }

    // Already finalized (idempotent against Stripe retries / multiple paid events).
    if (reconciliation.status !== 'draft') {
      res.status(200).json({ received: true, status: reconciliation.outcome });
      return;
    }

    if (isFailed) {
      await systemRepo.updateResource<PaymentReconciliation>({
        ...reconciliation,
        status: 'cancelled',
        outcome: 'error',
        disposition: event.type,
      });
      res.status(200).json({ received: true, status: 'error' });
      return;
    }

    const projectId = reconciliation.meta?.project;
    if (!projectId) {
      res.status(200).json({ received: false });
      return;
    }
    const project = await systemRepo.readResource<Project>('Project', projectId);
    const config = getStripeConfig(project);

    // Re-fetch authoritative status; only mark paid when Stripe confirms payment.
    const checkoutSessionId =
      reconciliation.identifier?.find((i) => i.system === STRIPE_CHECKOUT_SESSION_SYSTEM)?.value ?? sessionId;
    if (!checkoutSessionId) {
      res.status(200).json({ received: false });
      return;
    }
    const session = await new StripeProvider().getSession(checkoutSessionId, config);

    if (session.payment_status === 'paid') {
      // What the payer was actually charged, in Stripe's presentment currency
      // (Adaptive Pricing / Stripe FX). Record it as the authoritative paymentAmount;
      // detail[0].amount keeps the original XAF invoice amount.
      const settledCurrency = (session.currency ?? '').toUpperCase();
      const settledMajor = settledCurrency
        ? fromStripeMinorUnits(session.amount_total ?? 0, settledCurrency)
        : undefined;
      const invoiceAmount = reconciliation.detail?.[0]?.amount;
      await systemRepo.updateResource<PaymentReconciliation>({
        ...reconciliation,
        status: 'active',
        outcome: 'complete',
        disposition: 'Payment completed',
        paymentAmount:
          settledCurrency && settledMajor !== undefined
            ? { value: settledMajor, currency: settledCurrency as Money['currency'] }
            : reconciliation.paymentAmount,
        processNote: [
          ...(reconciliation.processNote ?? []),
          {
            type: 'display',
            text: `Stripe charged the payer ${settledMajor ?? '?'} ${settledCurrency} (Stripe FX / Adaptive Pricing) for invoice ${invoiceAmount?.value ?? ''} ${invoiceAmount?.currency ?? ''}`,
          },
        ],
      });
      await balanceInvoice(systemRepo, reconciliation);
      res.status(200).json({ received: true, status: 'complete' });
      return;
    }

    // Not yet paid (e.g. async payment still processing) — leave as draft.
    res.status(200).json({ received: true, status: session.payment_status });
  } catch (error) {
    globalLogger.error('[stripe] Webhook processing error', { error, sessionId, sessionRef });
    res.status(200).json({ received: false });
  }
};

/**
 * Marks the Invoice referenced by a completed PaymentReconciliation as balanced.
 * @param systemRepo - The system repository.
 * @param reconciliation - The completed PaymentReconciliation.
 */
async function balanceInvoice(
  systemRepo: ReturnType<typeof getGlobalSystemRepo>,
  reconciliation: PaymentReconciliation
): Promise<void> {
  const invoiceRef = reconciliation.detail?.[0]?.request as Reference<Invoice> | undefined;
  if (!invoiceRef?.reference) {
    return;
  }
  const invoice = await systemRepo.readReference<Invoice>(invoiceRef);
  if (invoice.status !== 'balanced') {
    await systemRepo.updateResource<Invoice>({ ...invoice, status: 'balanced' });
  }
}

export const paymentsRouter = Router();
paymentsRouter.post('/pawapay/callback', pawaPayCallbackHandler);
