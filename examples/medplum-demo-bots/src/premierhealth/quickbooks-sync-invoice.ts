// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * QuickBooks invoice sync trigger bot.
 *
 * Triggered by a Subscription on `Invoice`. When an invoice reaches status
 * 'balanced' (fully paid — the pawaPay/Stripe webhooks or manual reconciliation
 * flip it), this bot POSTs the server-side `Invoice/<id>/$qbo-sync` operation,
 * which pushes the invoice (and its settled payments) to QuickBooks Online.
 *
 * The bot is deliberately thin: all QBO access — OAuth token refresh/rotation,
 * Customer/Invoice/Payment writes, and idempotency via QBO identifiers — lives
 * in the server operation, because Intuit refresh tokens rotate on every refresh
 * and must be re-persisted into project secrets, which bots cannot write.
 * Re-delivery is safe: the operation skips already-synced invoices/payments.
 * Failures are logged and rethrown so the Subscription marks the execution
 * failed and retries (see docs/quickbooks-integration.md).
 */

import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Invoice } from '@medplum/fhirtypes';

export async function handler(medplum: MedplumClient, event: BotEvent<Invoice>): Promise<any> {
  const invoice = event.input;

  // Only act once the invoice is fully paid.
  if (invoice.status !== 'balanced') {
    return { skipped: 'not-balanced' };
  }
  if (!invoice.id) {
    return { skipped: 'no-id' };
  }

  try {
    const result = await medplum.post(medplum.fhirUrl('Invoice', invoice.id, '$qbo-sync'), {});
    return { status: 'synced', result };
  } catch (err) {
    // Rethrow so the Subscription retries; the operation is idempotent, so a
    // retry never double-posts to QuickBooks.
    console.error(`QuickBooks sync failed for Invoice/${invoice.id}:`, err);
    throw err;
  }
}
