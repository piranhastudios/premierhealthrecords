// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { allOk, badRequest, createReference, getReferenceString } from '@medplum/core';
import type { FhirRequest, FhirResponse } from '@medplum/fhir-router';
import type { Invoice, Money, OperationDefinition, ParametersParameter, Project } from '@medplum/fhirtypes';
import { randomUUID } from 'node:crypto';
import { getConfig } from '../../config/loader';
import { getAuthenticatedContext } from '../../context';
import type { PawaPayConfig } from '../../payments/pawapay';
import { PawaPayProvider, PAWAPAY_DEPOSIT_SYSTEM, PAWAPAY_SANDBOX_URL } from '../../payments/pawapay';
import { parseInputParameters } from './utils/parameters';

const operation: OperationDefinition = {
  resourceType: 'OperationDefinition',
  id: 'invoice-pay',
  url: 'https://medplum.com/fhir/OperationDefinition/invoice-pay',
  name: 'pay',
  status: 'active',
  kind: 'operation',
  code: 'pay',
  resource: ['Invoice'],
  system: false,
  type: false,
  instance: true,
  parameter: [
    {
      name: 'payerPhone',
      use: 'in',
      min: 1,
      max: '1',
      type: 'string',
      documentation: 'Payer MSISDN in international format, e.g. +237690000000 or 237690000000',
    },
    {
      name: 'correspondent',
      use: 'in',
      min: 1,
      max: '1',
      type: 'string',
      documentation: 'Mobile-money correspondent code, e.g. MTN_MOMO_CMR or ORANGE_CMR',
    },
    {
      name: 'amount',
      use: 'in',
      min: 0,
      max: '1',
      type: 'Money',
      documentation: 'Optional amount override; defaults to the Invoice total',
    },
    { name: 'depositId', use: 'out', min: 1, max: '1', type: 'string' },
    { name: 'status', use: 'out', min: 1, max: '1', type: 'string' },
    { name: 'paymentReconciliation', use: 'out', min: 1, max: '1', type: 'Reference' },
  ],
};

interface PayParameters {
  payerPhone: string;
  correspondent: string;
  amount?: Money;
}

/**
 * Resolves pawaPay connection settings from project secrets.
 * @param project - The current project.
 * @returns The resolved pawaPay config.
 */
export function getPawaPayConfig(project: Project): PawaPayConfig {
  // Prefer a per-project secret; fall back to a server env var for single-tenant
  // on-prem deployments (e.g. set PAWAPAY_API_TOKEN in the Coolify/Docker env).
  const apiToken =
    project.secret?.find((s) => s.name === 'PAWAPAY_API_TOKEN')?.valueString ?? process.env.PAWAPAY_API_TOKEN;
  if (!apiToken) {
    throw new Error(
      'pawaPay API token not configured (set the PAWAPAY_API_TOKEN project secret or environment variable)'
    );
  }
  const baseUrl =
    project.secret?.find((s) => s.name === 'PAWAPAY_BASE_URL')?.valueString ??
    process.env.PAWAPAY_BASE_URL ??
    PAWAPAY_SANDBOX_URL;
  return { apiToken, baseUrl };
}

/**
 * Handles the Invoice `$pay` operation: collect the invoice amount from the
 * patient via mobile money (pawaPay deposit).
 *
 * Flow: read the Invoice -> create a draft PaymentReconciliation keyed by a new
 * deposit id -> ask pawaPay to collect from the payer. pawaPay confirms the
 * outcome asynchronously via the callback handled in `payments/routes.ts`, which
 * finalizes the PaymentReconciliation and balances the Invoice.
 * @param req - The FHIR request (instance-level on Invoice).
 * @returns The FHIR response with depositId, status, and the PaymentReconciliation reference.
 */
export async function invoicePayHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const { id } = req.params;

  let config: PawaPayConfig;
  try {
    config = getPawaPayConfig(ctx.project);
  } catch (error) {
    return [badRequest((error as Error).message)];
  }

  const invoice = await ctx.repo.readResource<Invoice>('Invoice', id);
  const params = parseInputParameters<PayParameters>(operation, req);

  const amount: Money | undefined = params.amount ?? invoice.totalGross ?? invoice.totalNet;
  if (amount?.value === undefined) {
    return [badRequest('No amount to charge: provide an amount or set Invoice.totalGross')];
  }
  const currency = amount.currency ?? 'XAF';
  const payerMsisdn = params.payerPhone.replace(/[^0-9]/g, '');
  if (!payerMsisdn) {
    return [badRequest('Invalid payerPhone')];
  }

  const depositId = randomUUID();
  const now = new Date().toISOString();

  // Record the in-flight collection before calling out, so the async callback
  // can always correlate the deposit back to this Invoice.
  const paymentReconciliation = await ctx.repo.createResource({
    resourceType: 'PaymentReconciliation',
    status: 'draft',
    created: now,
    paymentDate: now,
    paymentAmount: { value: amount.value, currency },
    outcome: 'queued',
    identifier: [{ system: PAWAPAY_DEPOSIT_SYSTEM, value: depositId }],
    detail: [{ type: { coding: [{ code: 'deposit', display: 'Mobile money deposit' }] }, request: createReference(invoice) }],
  });

  const provider = new PawaPayProvider();
  let status: string;
  try {
    const result = await provider.initiateDeposit(
      {
        depositId,
        amount: String(amount.value),
        currency,
        correspondent: params.correspondent,
        payerMsisdn,
        statementDescription: 'Premier Health',
        metadata: [
          { fieldName: 'projectId', fieldValue: ctx.project.id as string },
          { fieldName: 'invoiceId', fieldValue: invoice.id as string },
        ],
      },
      config
    );
    status = result.status;
  } catch (error) {
    // Mark the attempt failed but keep the record for audit.
    await ctx.repo.updateResource({ ...paymentReconciliation, status: 'cancelled', outcome: 'error', disposition: (error as Error).message });
    return [badRequest((error as Error).message)];
  }

  // pawaPay rejected the request outright (not an in-flight collection).
  if (status !== 'ACCEPTED') {
    await ctx.repo.updateResource({ ...paymentReconciliation, status: 'cancelled', outcome: 'error', disposition: status });
  }

  const out: ParametersParameter[] = [
    { name: 'depositId', valueString: depositId },
    { name: 'status', valueString: status },
    { name: 'paymentReconciliation', valueReference: { reference: getReferenceString(paymentReconciliation) } },
  ];
  return [allOk, { resourceType: 'Parameters', parameter: out }];
}

// Reference the callback URL config so deployers know where pawaPay should post.
// (pawaPay posts deposit status callbacks to `${baseUrl}/payments/pawapay/callback`.)
export function getPawaPayCallbackUrl(): string {
  return new URL('payments/pawapay/callback', getConfig().baseUrl).toString();
}
