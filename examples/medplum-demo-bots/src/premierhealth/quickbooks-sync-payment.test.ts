// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { createReference, indexSearchParameterBundle, indexStructureDefinitionBundle } from '@medplum/core';
import { readJson, SEARCH_PARAMETER_BUNDLE_FILES } from '@medplum/definitions';
import type { Bundle, Invoice, Patient, PaymentReconciliation, SearchParameter } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { handler } from './quickbooks-sync-payment';

describe('quickbooks-sync-payment bot', () => {
  let medplum: MockClient;
  let patient: Patient;
  let invoice: Invoice;

  beforeAll(() => {
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-types.json') as Bundle);
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-resources.json') as Bundle);
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-medplum.json') as Bundle);
    for (const filename of SEARCH_PARAMETER_BUNDLE_FILES) {
      indexSearchParameterBundle(readJson(filename) as Bundle<SearchParameter>);
    }
  });

  beforeEach(async () => {
    medplum = new MockClient();
    patient = await medplum.createResource<Patient>({
      resourceType: 'Patient',
      name: [{ given: ['Jane'], family: 'Doe' }],
    });
    invoice = await medplum.createResource<Invoice>({
      resourceType: 'Invoice',
      status: 'balanced',
      subject: createReference(patient),
      date: new Date().toISOString(),
      totalGross: { value: 5000, currency: 'XAF' },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Mirrors the shape the payment rails create (see packages/server/src/fhir/operations/
  // checkout.ts + pay.ts): settled reconciliations are 'active' with the Invoice in
  // detail[0].request.
  async function createReconciliation(
    status: PaymentReconciliation['status'],
    target: Invoice | null = invoice // null => no detail[].request Invoice reference
  ): Promise<PaymentReconciliation> {
    const now = new Date().toISOString();
    return medplum.createResource<PaymentReconciliation>({
      resourceType: 'PaymentReconciliation',
      status,
      created: now,
      paymentDate: now.slice(0, 10),
      paymentAmount: { value: 5000, currency: 'XAF' },
      outcome: 'complete',
      detail: [
        {
          type: { coding: [{ code: 'deposit', display: 'Mobile money deposit' }] },
          ...(target ? { request: createReference(target) } : {}),
          amount: { value: 5000, currency: 'XAF' },
        },
      ],
    });
  }

  function event(input: PaymentReconciliation): any {
    return {
      bot: { reference: 'Bot/x' },
      input,
      secrets: {},
      contentType: 'application/fhir+json',
    };
  }

  // NOTE: spies are installed AFTER resource creation — MockClient.createResource
  // itself goes through medplum.post, so an earlier spy would swallow the setup calls.
  test('active reconciliation on a balanced invoice triggers $qbo-sync', async () => {
    const reconciliation = await createReconciliation('active');
    const postSpy = vi
      .spyOn(medplum, 'post')
      .mockResolvedValue({ resourceType: 'Parameters', parameter: [{ name: 'paymentsSynced', valueInteger: 1 }] });

    const result = await handler(medplum, event(reconciliation));

    expect(result.status).toBe('synced');
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy.mock.calls[0][0].toString()).toContain(`/Invoice/${invoice.id}/$qbo-sync`);
    expect(postSpy.mock.calls[0][1]).toEqual({});
  });

  test('non-active (pending draft) reconciliation is a no-op', async () => {
    const reconciliation = await createReconciliation('draft');
    const postSpy = vi.spyOn(medplum, 'post');

    const result = await handler(medplum, event(reconciliation));

    expect(result).toEqual({ skipped: 'not-active' });
    expect(postSpy).not.toHaveBeenCalled();
  });

  test('cancelled reconciliation is a no-op', async () => {
    const reconciliation = await createReconciliation('cancelled');
    const postSpy = vi.spyOn(medplum, 'post');

    const result = await handler(medplum, event(reconciliation));

    expect(result).toEqual({ skipped: 'not-active' });
    expect(postSpy).not.toHaveBeenCalled();
  });

  test('active reconciliation without an Invoice reference is a no-op', async () => {
    const reconciliation = await createReconciliation('active', null);
    const postSpy = vi.spyOn(medplum, 'post');

    const result = await handler(medplum, event(reconciliation));

    expect(result).toEqual({ skipped: 'no-invoice' });
    expect(postSpy).not.toHaveBeenCalled();
  });

  test('active reconciliation on a not-yet-balanced invoice waits', async () => {
    const partiallyPaid = await medplum.createResource<Invoice>({
      resourceType: 'Invoice',
      status: 'issued',
      subject: createReference(patient),
      date: new Date().toISOString(),
      totalGross: { value: 10000, currency: 'XAF' },
    });
    const reconciliation = await createReconciliation('active', partiallyPaid);
    const postSpy = vi.spyOn(medplum, 'post');

    const result = await handler(medplum, event(reconciliation));

    expect(result).toEqual({ skipped: 'invoice-not-balanced' });
    expect(postSpy).not.toHaveBeenCalled();
  });

  test('operation failure is logged and rethrown so the subscription retries', async () => {
    const reconciliation = await createReconciliation('active');
    vi.spyOn(medplum, 'post').mockRejectedValue(new Error('QBO 500'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(handler(medplum, event(reconciliation))).rejects.toThrow('QBO 500');
    expect(consoleSpy).toHaveBeenCalled();
  });
});
