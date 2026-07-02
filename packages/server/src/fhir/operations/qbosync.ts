// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Invoice `$qbo-sync` operation: push a balanced Invoice (and its settled
 * payments) to QuickBooks Online.
 *
 * All QBO access lives server-side because Intuit refresh tokens ROTATE on every
 * refresh and must be re-persisted into project secrets — bots cannot write
 * project secrets, so the sync bots stay thin and call this operation instead.
 * See docs/quickbooks-integration.md.
 */
import { allOk, badRequest, getReferenceString, Operator } from '@medplum/core';
import type { FhirRequest, FhirResponse } from '@medplum/fhir-router';
import type {
  ChargeItem,
  ChargeItemDefinition,
  Invoice,
  OperationDefinition,
  ParametersParameter,
  Patient,
  PaymentReconciliation,
  Reference,
} from '@medplum/fhirtypes';
import type { QboInvoiceLine, QuickBooksConfig } from '../../accounting/quickbooks';
import {
  getQuickBooksConfig,
  QBO_CUSTOMER_ID_SYSTEM,
  QBO_INVOICE_ID_SYSTEM,
  QBO_ITEM_ID_SYSTEM,
  QBO_PAYMENT_ID_SYSTEM,
  QuickBooksApiError,
  QuickBooksProvider,
} from '../../accounting/quickbooks';
import { persistRotatedTokensIfAny } from '../../accounting/utils';
import { getAuthenticatedContext } from '../../context';
import type { Repository } from '../repo';

export const qboSyncOperation: OperationDefinition = {
  resourceType: 'OperationDefinition',
  id: 'invoice-qbo-sync',
  url: 'https://medplum.com/fhir/OperationDefinition/invoice-qbo-sync',
  name: 'qbo-sync',
  status: 'active',
  kind: 'operation',
  code: 'qbo-sync',
  resource: ['Invoice'],
  system: false,
  type: false,
  instance: true,
  parameter: [
    { name: 'qboInvoiceId', use: 'out', min: 1, max: '1', type: 'string' },
    { name: 'qboCustomerId', use: 'out', min: 1, max: '1', type: 'string' },
    { name: 'paymentsSynced', use: 'out', min: 1, max: '1', type: 'integer' },
  ],
};

/** QBO reference-number fields (DocNumber / PaymentRefNum) max out at 21 chars. */
const QBO_REF_MAX_LENGTH = 21;

/**
 * Handles the Invoice `$qbo-sync` operation.
 *
 * Flow: require `status = balanced` -> ensure a QBO Customer for the subject
 * Patient (persisting the id back as a Patient identifier) -> push the QBO
 * Invoice unless the FHIR Invoice already carries a QBO invoice identifier
 * (idempotent) -> record a QBO Payment for each settled PaymentReconciliation
 * that references this Invoice and has no QBO payment identifier yet -> persist
 * any rotated OAuth tokens.
 * @param req - The FHIR request (instance-level on Invoice).
 * @returns The FHIR response with qboInvoiceId, qboCustomerId, and paymentsSynced.
 */
export async function invoiceQboSyncHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const { id } = req.params;

  let config: QuickBooksConfig;
  try {
    config = getQuickBooksConfig(ctx.project);
  } catch (error) {
    return [badRequest((error as Error).message)];
  }

  const invoice = await ctx.repo.readResource<Invoice>('Invoice', id);
  if (invoice.status !== 'balanced') {
    return [badRequest(`Only balanced invoices are pushed to QuickBooks (status is '${invoice.status}')`)];
  }

  if (!invoice.subject?.reference?.startsWith('Patient/')) {
    return [badRequest('Invoice.subject must reference a Patient')];
  }
  const patient = await ctx.repo.readReference(invoice.subject as Reference<Patient>);

  const provider = new QuickBooksProvider(config);
  try {
    // Patient -> QBO Customer (idempotent: stored identifier, then DisplayName lookup, then create).
    const { customerId } = await provider.ensureCustomer(patient);
    if (!patient.identifier?.some((i) => i.system === QBO_CUSTOMER_ID_SYSTEM && i.value === customerId)) {
      await ctx.repo.updateResource<Patient>({
        ...patient,
        identifier: [
          ...(patient.identifier ?? []).filter((i) => i.system !== QBO_CUSTOMER_ID_SYSTEM),
          { system: QBO_CUSTOMER_ID_SYSTEM, value: customerId },
        ],
      });
    }

    // Invoice push (skipped when already synced — idempotent).
    let qboInvoiceId = invoice.identifier?.find((i) => i.system === QBO_INVOICE_ID_SYSTEM)?.value;
    if (!qboInvoiceId) {
      const lines = await buildInvoiceLines(ctx.repo, provider, invoice);
      const result = await provider.upsertInvoice({
        customerId,
        lines,
        docNumber: invoice.id?.slice(0, QBO_REF_MAX_LENGTH),
      });
      qboInvoiceId = result.invoiceId;
      await ctx.repo.updateResource<Invoice>({
        ...invoice,
        identifier: [...(invoice.identifier ?? []), { system: QBO_INVOICE_ID_SYSTEM, value: qboInvoiceId }],
      });
    }

    // Payment push: every settled (status active / outcome complete) reconciliation
    // for this invoice that has not been pushed yet. NOTE: the R4 `request` search
    // parameter targets PaymentReconciliation.request (a Task reference), while the
    // payment rails store the Invoice in detail[0].request — so filter in memory.
    // The status filter is project-wide, so page through ALL results (this invoice's
    // payments may sit beyond any single page); matches are collected before any
    // update so the paging offsets stay stable.
    const invoiceRef = getReferenceString(invoice);
    const pageSize = 1000;
    const reconciliations: PaymentReconciliation[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const page = await ctx.repo.searchResources<PaymentReconciliation>({
        resourceType: 'PaymentReconciliation',
        filters: [{ code: 'status', operator: Operator.EQUALS, value: 'active' }],
        count: pageSize,
        offset,
      });
      reconciliations.push(...page.filter((r) => r.detail?.[0]?.request?.reference === invoiceRef));
      if (page.length < pageSize) {
        break;
      }
    }
    let paymentsSynced = 0;
    for (const reconciliation of reconciliations) {
      if (reconciliation.identifier?.some((i) => i.system === QBO_PAYMENT_ID_SYSTEM)) {
        continue; // Already pushed — idempotent.
      }
      // Post in the invoice currency (XAF): detail[0].amount keeps the invoice
      // amount, while paymentAmount may hold a foreign settled amount (Stripe
      // Adaptive Pricing). See docs/quickbooks-integration.md §8.
      const amount = reconciliation.detail?.[0]?.amount ?? reconciliation.paymentAmount;
      if (amount?.value === undefined) {
        continue;
      }
      const payment = await provider.recordPayment({
        customerId,
        qboInvoiceId,
        amount: amount.value,
        paymentRefNum: reconciliation.id?.slice(0, QBO_REF_MAX_LENGTH),
      });
      await ctx.repo.updateResource<PaymentReconciliation>({
        ...reconciliation,
        identifier: [...(reconciliation.identifier ?? []), { system: QBO_PAYMENT_ID_SYSTEM, value: payment.paymentId }],
      });
      paymentsSynced++;
    }

    const out: ParametersParameter[] = [
      { name: 'qboInvoiceId', valueString: qboInvoiceId },
      { name: 'qboCustomerId', valueString: customerId },
      { name: 'paymentsSynced', valueInteger: paymentsSynced },
    ];
    return [allOk, { resourceType: 'Parameters', parameter: out }];
  } catch (error) {
    if (error instanceof QuickBooksApiError && !error.retryable) {
      return [badRequest(error.message)];
    }
    throw error; // 5xx / transient — surface as a server error so callers retry.
  } finally {
    // The refresh token rotates; persist it even when the sync itself failed.
    await persistRotatedTokensIfAny(ctx.repo.getSystemRepo(), ctx.project.id, provider);
  }
}

/**
 * Builds the QBO invoice lines from Invoice.lineItem: resolve the ChargeItem for
 * a description, map to a QBO Item via a QBO item identifier on the ChargeItem or
 * its ChargeItemDefinition (else the default "Healthcare Services" item), and take
 * the amount from the base priceComponent. Falls back to a single line for the
 * invoice total when no usable line items exist.
 * @param repo - The caller's repository.
 * @param provider - The QuickBooks provider.
 * @param invoice - The FHIR Invoice.
 * @returns The QBO invoice lines.
 */
async function buildInvoiceLines(
  repo: Repository,
  provider: QuickBooksProvider,
  invoice: Invoice
): Promise<QboInvoiceLine[]> {
  let defaultItemId: string | undefined;
  const getDefaultItemId = async (): Promise<string> => {
    defaultItemId ??= await provider.getOrCreateDefaultServiceItem();
    return defaultItemId;
  };

  const lines: QboInvoiceLine[] = [];
  for (const lineItem of invoice.lineItem ?? []) {
    const amount = lineItem.priceComponent?.find((pc) => pc.amount?.value !== undefined)?.amount?.value;
    if (amount === undefined) {
      continue;
    }

    let chargeItem: ChargeItem | undefined;
    if (lineItem.chargeItemReference?.reference) {
      try {
        chargeItem = await repo.readReference(lineItem.chargeItemReference);
      } catch {
        // Unresolvable ChargeItem — fall through to the CodeableConcept/default description.
      }
    }

    let itemId = chargeItem?.identifier?.find((i) => i.system === QBO_ITEM_ID_SYSTEM)?.value;
    if (!itemId && chargeItem?.definitionCanonical?.[0]) {
      // ChargeItems created by charge capture point at a ChargeItemDefinition, which
      // carries the QBO Item id stamped by the pricing pull ($qbo-pull-pricing).
      const definition = await repo.searchOne<ChargeItemDefinition>({
        resourceType: 'ChargeItemDefinition',
        filters: [{ code: 'url', operator: Operator.EQUALS, value: chargeItem.definitionCanonical[0] }],
      });
      itemId = definition?.identifier?.find((i) => i.system === QBO_ITEM_ID_SYSTEM)?.value;
    }

    const description =
      chargeItem?.code?.text ??
      chargeItem?.code?.coding?.[0]?.display ??
      lineItem.chargeItemCodeableConcept?.text ??
      `Premier Health invoice ${invoice.id} line ${lineItem.sequence ?? lines.length + 1}`;

    lines.push({ itemId: itemId ?? (await getDefaultItemId()), amount, description });
  }

  if (lines.length === 0) {
    const total = invoice.totalGross?.value ?? invoice.totalNet?.value;
    if (total === undefined) {
      throw new QuickBooksApiError(
        'Invoice has no line items with amounts and no totalGross/totalNet to push to QuickBooks',
        400
      );
    }
    lines.push({
      itemId: await getDefaultItemId(),
      amount: total,
      description: `Premier Health invoice ${invoice.id}`,
    });
  }

  return lines;
}
