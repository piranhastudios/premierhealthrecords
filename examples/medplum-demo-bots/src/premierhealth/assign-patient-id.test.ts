// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { indexSearchParameterBundle, indexStructureDefinitionBundle } from '@medplum/core';
import { readJson, SEARCH_PARAMETER_BUNDLE_FILES } from '@medplum/definitions';
import type { Basic, Bundle, Patient, SearchParameter } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { handler } from './assign-patient-id';

const MRN_SYSTEM = 'https://premierhealth.cm/fhir/sid/mrn';
const CNI_SYSTEM = 'https://premierhealth.cm/fhir/sid/cni';
const COUNTER_SYSTEM = 'https://premierhealth.cm/fhir/sid/mrn-counter';
const LAST_SEQUENCE_URL = 'https://premierhealth.cm/fhir/StructureDefinition/mrn-last-sequence';

function event(input: Patient): any {
  return {
    bot: { reference: 'Bot/x' },
    input,
    secrets: {},
    contentType: 'application/fhir+json',
  };
}

function mrnValue(patient: Patient): string | undefined {
  return patient.identifier?.find((id) => id.system === MRN_SYSTEM)?.value;
}

function lastSequence(counter: Basic | undefined): number | undefined {
  return counter?.extension?.find((e) => e.url === LAST_SEQUENCE_URL)?.valueInteger;
}

describe('assign-patient-id bot', () => {
  let medplum: MockClient;

  beforeAll(() => {
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-types.json') as Bundle);
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-resources.json') as Bundle);
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-medplum.json') as Bundle);
    for (const filename of SEARCH_PARAMETER_BUNDLE_FILES) {
      indexSearchParameterBundle(readJson(filename) as Bundle<SearchParameter>);
    }
  });

  beforeEach(() => {
    medplum = new MockClient();
    // Pin the registration year so assertions are deterministic. Timers still advance
    // so the retry backoff (setTimeout) can resolve.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-03-15T10:00:00Z'));
  });

  function seedCounter(year: string, last: number): Promise<Basic> {
    return medplum.createResource<Basic>({
      resourceType: 'Basic',
      code: { coding: [{ system: COUNTER_SYSTEM, code: 'mrn-counter' }] },
      identifier: [{ system: COUNTER_SYSTEM, value: year }],
      extension: [{ url: LAST_SEQUENCE_URL, valueInteger: last }],
    });
  }

  function readCounter(year: string): Promise<Basic | undefined> {
    return medplum.searchOne('Basic', `identifier=${COUNTER_SYSTEM}|${year}`);
  }

  test('assigns an MRN with the correct format and creates the year counter', async () => {
    const patient = await medplum.createResource<Patient>({
      resourceType: 'Patient',
      name: [{ given: ['Jane'], family: 'Doe' }],
      birthDate: '1990-05-20',
    });

    const result = (await handler(medplum, event(patient))) as Patient;
    expect(mrnValue(result)).toBe('2026-1990-0001');

    const stored = await medplum.readResource('Patient', patient.id);
    expect(mrnValue(stored)).toBe('2026-1990-0001');

    // The per-year counter was created on demand and records the issued sequence.
    expect(lastSequence(await readCounter('2026'))).toBe(1);
  });

  test('increments the counter for a second patient created the same year', async () => {
    const first = await medplum.createResource<Patient>({
      resourceType: 'Patient',
      birthDate: '1990-05-20',
    });
    await handler(medplum, event(first));

    const second = await medplum.createResource<Patient>({
      resourceType: 'Patient',
      birthDate: '1985-01-02',
    });
    const result = (await handler(medplum, event(second))) as Patient;
    expect(mrnValue(result)).toBe('2026-1985-0002');
    expect(lastSequence(await readCounter('2026'))).toBe(2);
  });

  test('continues from a seeded counter instead of rescanning patients', async () => {
    await seedCounter('2026', 41);

    const patient = await medplum.createResource<Patient>({
      resourceType: 'Patient',
      birthDate: '1990-05-20',
    });
    const result = (await handler(medplum, event(patient))) as Patient;
    expect(mrnValue(result)).toBe('2026-1990-0042');
    expect(lastSequence(await readCounter('2026'))).toBe(42);
  });

  test('is idempotent — running twice does not add a second MRN or burn a sequence', async () => {
    const patient = await medplum.createResource<Patient>({
      resourceType: 'Patient',
      birthDate: '2000-12-31',
    });

    const first = (await handler(medplum, event(patient))) as Patient;
    expect(mrnValue(first)).toBe('2026-2000-0001');

    // Re-run with the now-updated resource as the trigger input.
    const second = await handler(medplum, event(first));
    expect(second).toEqual({ skipped: 'already-has-mrn' });

    const stored = await medplum.readResource('Patient', patient.id);
    const mrnCount = (stored.identifier ?? []).filter((id) => id.system === MRN_SYSTEM).length;
    expect(mrnCount).toBe(1);
    expect(lastSequence(await readCounter('2026'))).toBe(1);
  });

  test('preserves an existing CNI identifier', async () => {
    const patient = await medplum.createResource<Patient>({
      resourceType: 'Patient',
      birthDate: '1975-06-06',
      identifier: [{ system: CNI_SYSTEM, value: 'CM-123456789' }],
    });

    const result = (await handler(medplum, event(patient))) as Patient;
    expect(mrnValue(result)).toBe('2026-1975-0001');
    expect(result.identifier?.find((id) => id.system === CNI_SYSTEM)?.value).toBe('CM-123456789');
    expect(result.identifier).toHaveLength(2);
  });

  test('skips a patient with no birthDate without burning a sequence', async () => {
    const patient = await medplum.createResource<Patient>({
      resourceType: 'Patient',
      name: [{ family: 'NoBirthDate' }],
    });

    const result = await handler(medplum, event(patient));
    expect(result).toEqual({ skipped: 'no-birth-date' });
    expect(await readCounter('2026')).toBeUndefined();
  });

  test('treats an empty-string birthDate as missing (skipped)', async () => {
    const patient = await medplum.createResource<Patient>({
      resourceType: 'Patient',
      name: [{ family: 'EmptyBirthDate' }],
      birthDate: '',
    });

    const result = await handler(medplum, event(patient));
    expect(result).toEqual({ skipped: 'no-birth-date' });
  });

  test('assigns the MRN once the birth date is recorded (update firing)', async () => {
    const patient = await medplum.createResource<Patient>({
      resourceType: 'Patient',
      name: [{ family: 'LateBirthDate' }],
    });
    expect(await handler(medplum, event(patient))).toEqual({ skipped: 'no-birth-date' });

    const updated = await medplum.updateResource<Patient>({ ...patient, birthDate: '1993-07-04' });
    const result = (await handler(medplum, event(updated))) as Patient;
    expect(mrnValue(result)).toBe('2026-1993-0001');
  });

  test('stamps the MR identifier-type coding on the MRN', async () => {
    const patient = await medplum.createResource<Patient>({
      resourceType: 'Patient',
      birthDate: '1990-05-20',
    });

    const result = (await handler(medplum, event(patient))) as Patient;
    const mrn = result.identifier?.find((id) => id.system === MRN_SYSTEM);
    expect(mrn?.type?.coding?.[0]).toMatchObject({
      system: 'http://terminology.hl7.org/CodeSystem/v2-0203',
      code: 'MR',
    });
  });

  test('re-reads and retries when the counter increment hits a version conflict', async () => {
    // Seed the counter, then bump it so the saved copy is stale — as if another
    // registration won the race between our read and our guarded write.
    const stale = await seedCounter('2026', 41);
    await medplum.updateResource<Basic>({
      ...stale,
      extension: [{ url: LAST_SEQUENCE_URL, valueInteger: 42 }],
    });

    // First counter read returns the stale copy (old versionId), so the If-Match
    // increment fails with a conflict; the retry re-reads through the real client.
    const spy = vi.spyOn(medplum, 'createResourceIfNoneExist');
    spy.mockResolvedValueOnce(stale as any);

    const patient = await medplum.createResource<Patient>({
      resourceType: 'Patient',
      birthDate: '1990-05-20',
    });
    const result = (await handler(medplum, event(patient))) as Patient;

    expect(mrnValue(result)).toBe('2026-1990-0043');
    expect(lastSequence(await readCounter('2026'))).toBe(43);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
