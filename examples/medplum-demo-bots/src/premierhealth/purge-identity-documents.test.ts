// SPDX-FileCopyrightText: Copyright Premier Health Centres
// SPDX-License-Identifier: Apache-2.0
import { indexSearchParameterBundle, indexStructureDefinitionBundle } from '@medplum/core';
import { readJson, SEARCH_PARAMETER_BUNDLE_FILES } from '@medplum/definitions';
import type { Bundle, DocumentReference, Patient, SearchParameter } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { binaryIdFromUrl, handler } from './purge-identity-documents';

const DOCUMENT_TYPE_SYSTEM = 'https://premierhealth.cm/fhir/CodeSystem/document-type';
const IDENTITY_DOCUMENT_CODE = 'identity-document';
const IDENTITY_VERIFIED_EXTENSION = 'https://premierhealth.cm/fhir/StructureDefinition/identity-verified';
const DAY_MS = 24 * 60 * 60 * 1000;

describe('purge-identity-documents bot', () => {
  let medplum: MockClient;
  let patient: Patient;

  beforeAll(() => {
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-types.json') as Bundle);
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-resources.json') as Bundle);
    for (const filename of SEARCH_PARAMETER_BUNDLE_FILES) {
      indexSearchParameterBundle(readJson(filename) as Bundle<SearchParameter>);
    }
  });

  beforeEach(async () => {
    medplum = new MockClient();
    patient = await medplum.createResource<Patient>({ resourceType: 'Patient', name: [{ family: 'Ngatchu' }] });
  });

  async function createDocument(ageDays: number, docStatus: DocumentReference['docStatus']): Promise<DocumentReference> {
    const binary = await medplum.createResource({ resourceType: 'Binary', contentType: 'image/jpeg' } as never);
    return medplum.createResource<DocumentReference>({
      resourceType: 'DocumentReference',
      status: 'current',
      docStatus,
      type: { coding: [{ system: DOCUMENT_TYPE_SYSTEM, code: IDENTITY_DOCUMENT_CODE }] },
      subject: { reference: `Patient/${patient.id}` },
      date: new Date(Date.now() - ageDays * DAY_MS).toISOString(),
      content: [{ attachment: { contentType: 'image/jpeg', url: `Binary/${(binary as { id: string }).id}` } }],
    });
  }

  test('deletes a document past the 30 day retention window', async () => {
    const doc = await createDocument(31, 'preliminary');

    const result = await handler(medplum, {} as never);

    expect(result.deleted).toStrictEqual(1);
    await expect(medplum.readResource('DocumentReference', doc.id as string)).rejects.toThrow();
  });

  test('deletes the Binary too, not just the reference', async () => {
    // Deleting only the DocumentReference would leave the photograph on disk
    // with nothing pointing at it — the retention promise would be false.
    const doc = await createDocument(31, 'preliminary');
    const binaryId = binaryIdFromUrl(doc.content?.[0]?.attachment?.url);
    expect(binaryId).toBeDefined();

    await handler(medplum, {} as never);

    await expect(medplum.readResource('Binary', binaryId as string)).rejects.toThrow();
  });

  test('keeps a document that is still inside the window', async () => {
    const doc = await createDocument(29, 'preliminary');

    const result = await handler(medplum, {} as never);

    expect(result.deleted).toStrictEqual(0);
    await expect(medplum.readResource('DocumentReference', doc.id as string)).resolves.toBeDefined();
  });

  test('a verified patient stays verified after the document is deleted', async () => {
    // The whole point: keep the OUTCOME, discard the identity document.
    await createDocument(31, 'final');

    await handler(medplum, {} as never);

    const updated = await medplum.readResource('Patient', patient.id as string);
    expect(updated.extension?.some((e) => e.url === IDENTITY_VERIFIED_EXTENSION)).toBe(true);
  });

  test('does not mark a patient verified when the check never completed', async () => {
    await createDocument(31, 'preliminary');

    await handler(medplum, {} as never);

    const updated = await medplum.readResource('Patient', patient.id as string);
    expect(updated.extension?.some((e) => e.url === IDENTITY_VERIFIED_EXTENSION)).toBeFalsy();
  });

  test('is idempotent — a second run finds nothing left to do', async () => {
    await createDocument(31, 'preliminary');

    await handler(medplum, {} as never);
    const second = await handler(medplum, {} as never);

    expect(second.deleted).toStrictEqual(0);
  });

  test('ignores documents that are not identity documents', async () => {
    const other = await medplum.createResource<DocumentReference>({
      resourceType: 'DocumentReference',
      status: 'current',
      type: { coding: [{ system: 'http://loinc.org', code: '34133-9' }] },
      subject: { reference: `Patient/${patient.id}` },
      date: new Date(Date.now() - 400 * DAY_MS).toISOString(),
      content: [],
    });

    const result = await handler(medplum, {} as never);

    expect(result.deleted).toStrictEqual(0);
    await expect(medplum.readResource('DocumentReference', other.id as string)).resolves.toBeDefined();
  });

  describe('binaryIdFromUrl', () => {
    test('reads the id from a relative reference', () => {
      expect(binaryIdFromUrl('Binary/abc-123')).toStrictEqual('abc-123');
    });

    test('reads the id from a full storage URL', () => {
      expect(binaryIdFromUrl('https://example.com/api/storage/Binary/abc-123?x=1')).toStrictEqual('abc-123');
    });

    test('returns undefined when there is no binary', () => {
      expect(binaryIdFromUrl(undefined)).toBeUndefined();
    });
  });
});
