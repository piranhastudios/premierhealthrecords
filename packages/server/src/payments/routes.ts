// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Operator } from '@medplum/core';
import type { Invoice, PaymentReconciliation, Project, Reference } from '@medplum/fhirtypes';
import type { Request, Response } from 'express';
import { Router } from 'express';
import { getGlobalSystemRepo } from '../fhir/repo';
import { getPawaPayConfig } from '../fhir/operations/pay';
import { globalLogger } from '../logger';
import { PawaPayProvider, PAWAPAY_DEPOSIT_SYSTEM } from './pawapay';

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

/** Marks the Invoice referenced by a completed PaymentReconciliation as balanced. */
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
