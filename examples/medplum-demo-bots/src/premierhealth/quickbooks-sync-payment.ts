// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * QuickBooks payment sync trigger bot.
 *
 * Triggered by a Subscription on `PaymentReconciliation`. The payment rails
 * (pawaPay/Stripe webhooks, manual reconciliation in payments/routes.ts) flip a
 * settled reconciliation to status 'active' and keep the paid Invoice in
 * `detail[].request`. When that happens, this bot reads the invoice and — once
 * it is 'balanced' — POSTs the same server-side `Invoice/<id>/$qbo-sync`
 * operation the invoice bot uses; the operation records outstanding QBO
 * Payments idempotently (each reconciliation is pushed at most once, keyed by
 * its QBO payment identifier).
 *
 * Kept thin for the same reason as quickbooks-sync-invoice.ts: rotating Intuit
 * refresh tokens must be persisted into project secrets, which only the server
 * operation can do. Failures are logged and rethrown so the Subscription
 * retries (see docs/quickbooks-integration.md).
 */

import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Invoice, PaymentReconciliation, Reference } from '@medplum/fhirtypes';

export async function handler(medplum: MedplumClient, event: BotEvent<PaymentReconciliation>): Promise<any> {
  const reconciliation = event.input;

  // Only act on settled payments ('draft' = pending, 'cancelled'/'entered-in-error' = dead).
  if (reconciliation.status !== 'active') {
    return { skipped: 'not-active' };
  }

  // The payment rails store the paid Invoice in detail[].request.
  const invoiceRef = reconciliation.detail?.find((d) => d.request?.reference?.startsWith('Invoice/'))?.request;
  if (!invoiceRef) {
    return { skipped: 'no-invoice' };
  }

  const invoice = await medplum.readReference(invoiceRef as Reference<Invoice>);

  // The $qbo-sync operation requires a balanced invoice; partial payments wait
  // until the covering invoice settles (the invoice bot or a later payment
  // re-triggers the sync).
  if (invoice.status !== 'balanced') {
    return { skipped: 'invoice-not-balanced' };
  }

  try {
    const result = await medplum.post(medplum.fhirUrl('Invoice', invoice.id, '$qbo-sync'), {});
    return { status: 'synced', result };
  } catch (err) {
    // Rethrow so the Subscription retries; the operation is idempotent, so a
    // retry never double-posts to QuickBooks.
    console.error(`QuickBooks payment sync failed for Invoice/${invoice.id}:`, err);
    throw err;
  }
}
