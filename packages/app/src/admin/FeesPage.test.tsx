// SPDX-FileCopyrightText: Copyright Premier Health Centres
// SPDX-License-Identifier: Apache-2.0
import type { ChargeItemDefinition } from '@medplum/fhirtypes';
import { getBasePrice, withBasePrice } from './FeesPage';

const priced: ChargeItemDefinition = {
  resourceType: 'ChargeItemDefinition',
  url: 'https://premierhealth.cm/fhir/ChargeItemDefinition/consultation-general',
  status: 'active',
  title: 'General consultation',
  propertyGroup: [{ priceComponent: [{ type: 'base', amount: { value: 10000, currency: 'XAF' } }] }],
};

function withComponents(components: ChargeItemDefinition['propertyGroup']): ChargeItemDefinition {
  return {
    resourceType: 'ChargeItemDefinition',
    url: 'https://premierhealth.cm/fhir/ChargeItemDefinition/test',
    status: 'active',
    propertyGroup: components,
  };
}

describe('fees price helpers', () => {
  test('reads the base price', () => {
    expect(getBasePrice(priced)).toEqual({ value: 10000, currency: 'XAF' });
  });

  test('prefers the base component over a surcharge listed first', () => {
    const mixed = withComponents([
      {
        priceComponent: [
          { type: 'surcharge', amount: { value: 500, currency: 'XAF' } },
          { type: 'base', amount: { value: 7000, currency: 'XAF' } },
        ],
      },
    ]);
    expect(getBasePrice(mixed)?.value).toBe(7000);
  });

  test('an unpriced service reads as no price, which means free to book', () => {
    const bare: ChargeItemDefinition = {
      resourceType: 'ChargeItemDefinition',
      url: 'https://premierhealth.cm/fhir/ChargeItemDefinition/service-ecg',
      status: 'active',
      title: 'ECG & cardiology',
    };
    expect(getBasePrice(bare)).toBeUndefined();
  });

  test('updates an existing base price without mutating the original', () => {
    const next = withBasePrice(priced, 12500, 'XAF');
    expect(getBasePrice(next)).toEqual({ value: 12500, currency: 'XAF' });
    expect(getBasePrice(priced)?.value).toBe(10000);
  });

  test('leaves other price components alone', () => {
    const mixed = withComponents([
      {
        priceComponent: [
          { type: 'surcharge', amount: { value: 500, currency: 'XAF' } },
          { type: 'base', amount: { value: 7000, currency: 'XAF' } },
        ],
      },
    ]);
    expect(withBasePrice(mixed, 9000, 'XAF').propertyGroup?.[0].priceComponent).toEqual([
      { type: 'surcharge', amount: { value: 500, currency: 'XAF' } },
      { type: 'base', amount: { value: 9000, currency: 'XAF' } },
    ]);
  });

  test('adds a base component to a group that has none', () => {
    const noBase = withComponents([{ priceComponent: [{ type: 'surcharge', amount: { value: 500, currency: 'XAF' } }] }]);
    const next = withBasePrice(noBase, 4000, 'XAF');
    expect(getBasePrice(next)).toEqual({ value: 4000, currency: 'XAF' });
    expect(next.propertyGroup?.[0].priceComponent).toHaveLength(2);
  });

  test('prices a service that has never been priced', () => {
    const bare: ChargeItemDefinition = {
      resourceType: 'ChargeItemDefinition',
      url: 'https://premierhealth.cm/fhir/ChargeItemDefinition/service-ecg',
      status: 'active',
    };
    expect(withBasePrice(bare, 2500, 'XAF').propertyGroup).toEqual([
      { priceComponent: [{ type: 'base', amount: { value: 2500, currency: 'XAF' } }] },
    ]);
  });

  test('supports a deliberately free service', () => {
    expect(getBasePrice(withBasePrice(priced, 0, 'XAF'))?.value).toBe(0);
  });
});
