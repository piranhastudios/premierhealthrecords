// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { createReference, indexSearchParameterBundle, indexStructureDefinitionBundle } from '@medplum/core';
import { readJson, SEARCH_PARAMETER_BUNDLE_FILES } from '@medplum/definitions';
import type { Bundle, Invoice, Patient, SearchParameter } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { handler } from './quickbooks-sync-invoice';

describe('quickbooks-sync-invoice bot', () => {
  let medplum: MockClient;
  let patient: Patient;

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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function createInvoice(status: Invoice['status']): Promise<Invoice> {
    return medplum.createResource<Invoice>({
      resourceType: 'Invoice',
      status,
      subject: createReference(patient),
      date: new Date().toISOString(),
      totalGross: { value: 5000, currency: 'XAF' },
    });
  }

  function event(input: Invoice): any {
    return {
      bot: { reference: 'Bot/x' },
      input,
      secrets: {},
      contentType: 'application/fhir+json',
    };
  }

  // NOTE: spies are installed AFTER resource creation — MockClient.createResource
  // itself goes through medplum.post, so an earlier spy would swallow the setup calls.
  test('balanced invoice triggers $qbo-sync', async () => {
    const invoice = await createInvoice('balanced');
    const postSpy = vi
      .spyOn(medplum, 'post')
      .mockResolvedValue({ resourceType: 'Parameters', parameter: [{ name: 'qboInvoiceId', valueString: '145' }] });

    const result = await handler(medplum, event(invoice));

    expect(result.status).toBe('synced');
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy.mock.calls[0][0].toString()).toContain(`/Invoice/${invoice.id}/$qbo-sync`);
    expect(postSpy.mock.calls[0][1]).toEqual({});
  });

  test('non-balanced invoice is a no-op', async () => {
    const invoice = await createInvoice('issued');
    const postSpy = vi.spyOn(medplum, 'post');

    const result = await handler(medplum, event(invoice));

    expect(result).toEqual({ skipped: 'not-balanced' });
    expect(postSpy).not.toHaveBeenCalled();
  });

  test('draft invoice is a no-op', async () => {
    const invoice = await createInvoice('draft');
    const postSpy = vi.spyOn(medplum, 'post');

    const result = await handler(medplum, event(invoice));

    expect(result).toEqual({ skipped: 'not-balanced' });
    expect(postSpy).not.toHaveBeenCalled();
  });

  test('operation failure is logged and rethrown so the subscription retries', async () => {
    const invoice = await createInvoice('balanced');
    vi.spyOn(medplum, 'post').mockRejectedValue(new Error('QuickBooks is not connected'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(handler(medplum, event(invoice))).rejects.toThrow('QuickBooks is not connected');
    expect(consoleSpy).toHaveBeenCalled();
  });
});
