// SPDX-FileCopyrightText: Copyright Premier Health Centres
// SPDX-License-Identifier: Apache-2.0
import type { ChargeItemDefinition } from '@medplum/fhirtypes';
import { describe, expect, test } from 'vitest';
import { getBasePrice, withBasePrice } from './FeesPage';

const priced: ChargeItemDefinition = {
  resourceType: 'ChargeItemDefinition',
  url: 'https://premierhealth.cm/fhir/ChargeItemDefinition/consultation-general',
  status: 'active',
  title: 'General consultation',
  propertyGroup: [{ priceComponent: [{ type: 'base', amount: { value: 10000, currency: 'XAF' } }] }],
};

describe('fees price helpers', () => {
  test('reads the base price', () => {
    expect(getBasePrice(priced)).toEqual({ value: 10000, currency: 'XAF' });
  });

  test('prefers the base component over a surcharge listed first', () => {
    const mixed: ChargeItemDefinition = {
      resourceType: 'ChargeItemDefinition',
      url: 'https://premierhealth.cm/fhir/ChargeItemDefinition/test',
      status: 'active',
      propertyGroup: [
        {
          priceComponent: [
            { type: 'surcharge', amount: { value: 500, currency: 'XAF' } },
            { type: 'base', amount: { value: 7000, currency: 'XAF' } },
          ],
        },
      ],
    };
    expect(getBasePrice(mixed)?.value).toBe(7000);
  });

  test('returns undefined when there is no price at all', () => {
    expect(getBasePrice({ resourceType: 'ChargeItemDefinition', url: 'https://example.com/x', status: 'active' })).toBeUndefined();
  });

  test('updates an existing base price without touching the original', () => {
    const next = withBasePrice(priced, 12500, 'XAF');
    expect(getBasePrice(next)).toEqual({ value: 12500, currency: 'XAF' });
    expect(getBasePrice(priced)?.value).toBe(10000);
  });

  test('leaves other price components alone', () => {
    const mixed: ChargeItemDefinition = {
      resourceType: 'ChargeItemDefinition',
      url: 'https://premierhealth.cm/fhir/ChargeItemDefinition/test',
      status: 'active',
      propertyGroup: [
        {
          priceComponent: [
            { type: 'surcharge', amount: { value: 500, currency: 'XAF' } },
            { type: 'base', amount: { value: 7000, currency: 'XAF' } },
          ],
        },
      ],
    };
    const next = withBasePrice(mixed, 9000, 'XAF');
    expect(next.propertyGroup?.[0].priceComponent).toEqual([
      { type: 'surcharge', amount: { value: 500, currency: 'XAF' } },
      { type: 'base', amount: { value: 9000, currency: 'XAF' } },
    ]);
  });

  test('adds a base component to a group that has none', () => {
    const noBase: ChargeItemDefinition = {
      resourceType: 'ChargeItemDefinition',
      url: 'https://premierhealth.cm/fhir/ChargeItemDefinition/test',
      status: 'active',
      propertyGroup: [{ priceComponent: [{ type: 'surcharge', amount: { value: 500, currency: 'XAF' } }] }],
    };
    const next = withBasePrice(noBase, 4000, 'XAF');
    expect(getBasePrice(next)).toEqual({ value: 4000, currency: 'XAF' });
    expect(next.propertyGroup?.[0].priceComponent).toHaveLength(2);
  });

  test('prices a definition that has never been priced', () => {
    const bare: ChargeItemDefinition = { resourceType: 'ChargeItemDefinition', url: 'https://example.com/bare', status: 'active' };
    const next = withBasePrice(bare, 2500, 'XAF');
    expect(next.propertyGroup).toEqual([{ priceComponent: [{ type: 'base', amount: { value: 2500, currency: 'XAF' } }] }]);
  });

  test('supports a free service', () => {
    expect(getBasePrice(withBasePrice(priced, 0, 'XAF'))?.value).toBe(0);
  });
});
