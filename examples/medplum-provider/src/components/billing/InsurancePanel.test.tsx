// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { Coverage } from '@medplum/fhirtypes';
import { describe, expect, test } from 'vitest';
import { getCoinsurancePercent } from './InsurancePanel';

const base: Coverage = {
  resourceType: 'Coverage',
  status: 'active',
  beneficiary: { reference: 'Patient/1' },
  payor: [{ reference: 'Organization/2', display: 'Zenithe Insurance' }],
};

describe('getCoinsurancePercent', () => {
  test('reads the patient share', () => {
    expect(
      getCoinsurancePercent({
        ...base,
        costToBeneficiary: [{ valueQuantity: { value: 20, unit: '%', code: '%', system: 'http://unitsofmeasure.org' } }],
      })
    ).toBe(20);
  });

  test('is undefined when no share is recorded', () => {
    expect(getCoinsurancePercent(base)).toBeUndefined();
  });

  test('ignores a fixed-amount copay, which is not a percentage', () => {
    expect(
      getCoinsurancePercent({
        ...base,
        costToBeneficiary: [{ valueMoney: { value: 5000, currency: 'XAF' } }],
      })
    ).toBeUndefined();
  });

  test('picks the percentage when a fixed amount is listed first', () => {
    expect(
      getCoinsurancePercent({
        ...base,
        costToBeneficiary: [
          { valueMoney: { value: 5000, currency: 'XAF' } },
          { valueQuantity: { value: 30, unit: '%', code: '%', system: 'http://unitsofmeasure.org' } },
        ],
      })
    ).toBe(30);
  });

  test('treats a zero share as a real value, not missing', () => {
    expect(
      getCoinsurancePercent({
        ...base,
        costToBeneficiary: [{ valueQuantity: { value: 0, unit: '%', code: '%', system: 'http://unitsofmeasure.org' } }],
      })
    ).toBe(0);
  });
});
