// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { createReference, indexSearchParameterBundle, indexStructureDefinitionBundle, LOINC } from '@medplum/core';
import { readJson, SEARCH_PARAMETER_BUNDLE_FILES } from '@medplum/definitions';
import type { Bundle, Encounter, Observation, Patient, Quantity, SearchParameter } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { handler } from './calculate-bmi';

const CODE_BODY_WEIGHT = '29463-7';
const CODE_BODY_HEIGHT = '8302-2';
const CODE_BMI = '39156-5';

describe('calculate-bmi bot', () => {
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

  async function createVital(
    code: string,
    display: string,
    value: Quantity,
    effectiveDateTime: string,
    encounter?: Encounter
  ): Promise<Observation> {
    return medplum.createResource<Observation>({
      resourceType: 'Observation',
      status: 'final',
      category: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/observation-category',
              code: 'vital-signs',
              display: 'Vital Signs',
            },
          ],
        },
      ],
      code: { coding: [{ system: LOINC, code, display }] },
      subject: createReference(patient),
      ...(encounter ? { encounter: createReference(encounter) } : {}),
      effectiveDateTime,
      valueQuantity: value,
    });
  }

  function event(input: Observation): any {
    return {
      bot: { reference: 'Bot/x' },
      input,
      secrets: {},
      contentType: 'application/fhir+json',
    };
  }

  async function findBmis(): Promise<Observation[]> {
    return medplum.searchResources('Observation', {
      subject: createReference(patient).reference,
      code: `${LOINC}|${CODE_BMI}`,
    });
  }

  test('height 1.8 m + weight 81 kg -> BMI 25.0', async () => {
    await createVital(
      CODE_BODY_HEIGHT,
      'Body height',
      { value: 1.8, unit: 'm', system: 'http://unitsofmeasure.org', code: 'm' },
      '2026-06-01T10:00:00Z'
    );
    const weight = await createVital(
      CODE_BODY_WEIGHT,
      'Body weight',
      { value: 81, unit: 'kg', system: 'http://unitsofmeasure.org', code: 'kg' },
      '2026-06-01T10:05:00Z'
    );

    const result = (await handler(medplum, event(weight))) as Observation;
    expect(result?.resourceType).toBe('Observation');
    expect(result.valueQuantity?.value).toBe(25);
    expect(result.valueQuantity?.code).toBe('kg/m2');
    expect(result.code?.coding?.[0]?.code).toBe(CODE_BMI);
    expect(result.status).toBe('final');
    expect(result.derivedFrom?.length).toBe(2);
    // effectiveDateTime is the later of the two readings (the weight at 10:05).
    expect(result.effectiveDateTime).toBe('2026-06-01T10:05:00Z');
    expect((await findBmis()).length).toBe(1);
  });

  test('height in cm (180) normalizes correctly', async () => {
    await createVital(
      CODE_BODY_HEIGHT,
      'Body height',
      { value: 180, unit: 'cm', system: 'http://unitsofmeasure.org', code: 'cm' },
      '2026-06-01T10:00:00Z'
    );
    const weight = await createVital(
      CODE_BODY_WEIGHT,
      'Body weight',
      { value: 81, unit: 'kg', system: 'http://unitsofmeasure.org', code: 'kg' },
      '2026-06-01T10:05:00Z'
    );

    const result = (await handler(medplum, event(weight))) as Observation;
    expect(result.valueQuantity?.value).toBe(25);
  });

  test('weight in lb normalizes correctly', async () => {
    // 180 lb ~= 81.65 kg, height 1.8 m -> BMI ~25.2
    await createVital(
      CODE_BODY_HEIGHT,
      'Body height',
      { value: 1.8, unit: 'm', system: 'http://unitsofmeasure.org', code: 'm' },
      '2026-06-01T10:00:00Z'
    );
    const weight = await createVital(
      CODE_BODY_WEIGHT,
      'Body weight',
      { value: 180, unit: 'lb', system: 'http://unitsofmeasure.org', code: '[lb_av]' },
      '2026-06-01T10:05:00Z'
    );

    const result = (await handler(medplum, event(weight))) as Observation;
    expect(result.valueQuantity?.value).toBe(25.2);
  });

  test('only weight present (no height) -> no BMI created', async () => {
    const weight = await createVital(
      CODE_BODY_WEIGHT,
      'Body weight',
      { value: 81, unit: 'kg', system: 'http://unitsofmeasure.org', code: 'kg' },
      '2026-06-01T10:05:00Z'
    );

    const result = await handler(medplum, event(weight));
    expect(result).toBeUndefined();
    expect((await findBmis()).length).toBe(0);
  });

  test('re-running updates the existing BMI instead of duplicating', async () => {
    const height = await createVital(
      CODE_BODY_HEIGHT,
      'Body height',
      { value: 1.8, unit: 'm', system: 'http://unitsofmeasure.org', code: 'm' },
      '2026-06-01T10:00:00Z'
    );
    const weight = await createVital(
      CODE_BODY_WEIGHT,
      'Body weight',
      { value: 81, unit: 'kg', system: 'http://unitsofmeasure.org', code: 'kg' },
      '2026-06-01T10:05:00Z'
    );

    const first = (await handler(medplum, event(weight))) as Observation;
    const second = (await handler(medplum, event(height))) as Observation;

    expect(second.id).toBe(first.id);
    expect((await findBmis()).length).toBe(1);
  });

  test('re-running with a new weight updates the same BMI (encounter-scoped)', async () => {
    const encounter = await medplum.createResource<Encounter>({
      resourceType: 'Encounter',
      status: 'in-progress',
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' },
      subject: createReference(patient),
    });
    await createVital(
      CODE_BODY_HEIGHT,
      'Body height',
      { value: 1.8, unit: 'm', system: 'http://unitsofmeasure.org', code: 'm' },
      '2026-06-01T10:00:00Z',
      encounter
    );
    const weight1 = await createVital(
      CODE_BODY_WEIGHT,
      'Body weight',
      { value: 81, unit: 'kg', system: 'http://unitsofmeasure.org', code: 'kg' },
      '2026-06-01T10:05:00Z',
      encounter
    );
    const first = (await handler(medplum, event(weight1))) as Observation;
    expect(first.valueQuantity?.value).toBe(25);
    expect(first.encounter?.reference).toBe(createReference(encounter).reference);

    // A corrected weight in the same encounter should update the same BMI.
    const weight2 = await createVital(
      CODE_BODY_WEIGHT,
      'Body weight',
      { value: 90, unit: 'kg', system: 'http://unitsofmeasure.org', code: 'kg' },
      '2026-06-01T10:10:00Z',
      encounter
    );
    const second = (await handler(medplum, event(weight2))) as Observation;
    expect(second.id).toBe(first.id);
    expect(second.valueQuantity?.value).toBe(27.8);
    expect((await findBmis()).length).toBe(1);
  });

  test('a corrected weight later the same day updates the same BMI (date-scoped)', async () => {
    await createVital(
      CODE_BODY_HEIGHT,
      'Body height',
      { value: 1.8, unit: 'm', system: 'http://unitsofmeasure.org', code: 'm' },
      '2026-06-01T10:00:00Z'
    );
    const weight1 = await createVital(
      CODE_BODY_WEIGHT,
      'Body weight',
      { value: 81, unit: 'kg', system: 'http://unitsofmeasure.org', code: 'kg' },
      '2026-06-01T10:05:00Z'
    );
    const first = (await handler(medplum, event(weight1))) as Observation;
    expect(first.valueQuantity?.value).toBe(25);

    // A corrected weight later the same day maps to the same day-precision key.
    const weight2 = await createVital(
      CODE_BODY_WEIGHT,
      'Body weight',
      { value: 90, unit: 'kg', system: 'http://unitsofmeasure.org', code: 'kg' },
      '2026-06-01T23:59:00Z'
    );
    const second = (await handler(medplum, event(weight2))) as Observation;
    expect(second.id).toBe(first.id);
    expect(second.valueQuantity?.value).toBe(27.8);
    expect((await findBmis()).length).toBe(1);
  });

  test('uses a server-enforced conditional create keyed to day precision', async () => {
    // A day-precision height and a datetime weight must not fork duplicate BMIs.
    const height = await createVital(
      CODE_BODY_HEIGHT,
      'Body height',
      { value: 1.8, unit: 'm', system: 'http://unitsofmeasure.org', code: 'm' },
      '2026-06-01'
    );
    const weight = await createVital(
      CODE_BODY_WEIGHT,
      'Body weight',
      { value: 81, unit: 'kg', system: 'http://unitsofmeasure.org', code: 'kg' },
      '2026-06-01T10:05:00Z'
    );

    const spy = vi.spyOn(medplum, 'createResourceIfNoneExist');
    const first = (await handler(medplum, event(weight))) as Observation;
    const second = (await handler(medplum, event(height))) as Observation;

    expect(second.id).toBe(first.id);
    expect((await findBmis()).length).toBe(1);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith(
      expect.objectContaining({ resourceType: 'Observation' }),
      `subject=Patient/${patient.id}&code=${LOINC}|${CODE_BMI}&date=2026-06-01`
    );
  });

  test('unrelated Observation code is a no-op', async () => {
    const heartRate = await createVital(
      '8867-4',
      'Heart rate',
      { value: 72, unit: '/min', system: 'http://unitsofmeasure.org', code: '/min' },
      '2026-06-01T10:05:00Z'
    );
    const result = await handler(medplum, event(heartRate));
    expect(result).toBeUndefined();
    expect((await findBmis()).length).toBe(0);
  });
});
