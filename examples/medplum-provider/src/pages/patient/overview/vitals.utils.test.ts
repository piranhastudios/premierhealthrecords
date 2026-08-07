// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { Observation } from '@medplum/fhirtypes';
import { describe, expect, test } from 'vitest';
import type { VitalMetricDef } from './vitals.utils';
import {
  buildVitalSeries,
  filterByRange,
  formatVitalValue,
  getLatestVital,
  getObservationTime,
  VITAL_METRICS,
} from './vitals.utils';

function metric(key: string): VitalMetricDef {
  const found = VITAL_METRICS.find((m) => m.key === key);
  if (!found) {
    throw new Error(`Unknown metric: ${key}`);
  }
  return found;
}

const bp = metric('bp');
const hr = metric('hr');
const temp = metric('temp');

function bpPanel(effectiveDateTime: string, systolic: number, diastolic: number): Observation {
  return {
    resourceType: 'Observation',
    status: 'final',
    effectiveDateTime,
    code: { coding: [{ system: 'http://loinc.org', code: '85354-9' }] },
    component: [
      {
        code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] },
        valueQuantity: { value: systolic, unit: 'mm[Hg]' },
      },
      {
        code: { coding: [{ system: 'http://loinc.org', code: '8462-4' }] },
        valueQuantity: { value: diastolic, unit: 'mm[Hg]' },
      },
    ],
  };
}

function simple(code: string, effectiveDateTime: string, value: number): Observation {
  return {
    resourceType: 'Observation',
    status: 'final',
    effectiveDateTime,
    code: { coding: [{ system: 'http://loinc.org', code }] },
    valueQuantity: { value },
  };
}

describe('vitals.utils', () => {
  describe('getObservationTime', () => {
    test('prefers effectiveDateTime', () => {
      const obs = simple('8867-4', '2026-01-02T10:00:00.000Z', 70);
      expect(getObservationTime(obs)).toBe(new Date('2026-01-02T10:00:00.000Z').getTime());
    });

    test('falls back to effectivePeriod, issued, then lastUpdated', () => {
      expect(
        getObservationTime({
          resourceType: 'Observation',
          status: 'final',
          code: {},
          effectivePeriod: { start: '2026-01-02T10:00:00.000Z' },
        })
      ).toBe(new Date('2026-01-02T10:00:00.000Z').getTime());

      expect(
        getObservationTime({
          resourceType: 'Observation',
          status: 'final',
          code: {},
          meta: { lastUpdated: '2026-01-03T10:00:00.000Z' },
        })
      ).toBe(new Date('2026-01-03T10:00:00.000Z').getTime());
    });

    test('returns undefined without a usable date', () => {
      expect(getObservationTime({ resourceType: 'Observation', status: 'final', code: {} })).toBeUndefined();
    });
  });

  describe('buildVitalSeries', () => {
    test('reads both components of a blood pressure panel into one datum', () => {
      const data = buildVitalSeries([bpPanel('2026-01-02T10:00:00.000Z', 120, 80)], bp);
      expect(data).toHaveLength(1);
      expect(data[0].systolic).toBe(120);
      expect(data[0].diastolic).toBe(80);
    });

    test('merges standalone systolic/diastolic observations recorded at the same minute', () => {
      const data = buildVitalSeries(
        [simple('8480-6', '2026-01-02T10:00:10.000Z', 118), simple('8462-4', '2026-01-02T10:00:40.000Z', 76)],
        bp
      );
      expect(data).toHaveLength(1);
      expect(data[0].systolic).toBe(118);
      expect(data[0].diastolic).toBe(76);
    });

    test('orders points oldest first', () => {
      const data = buildVitalSeries(
        [
          simple('8867-4', '2026-03-01T10:00:00.000Z', 72),
          simple('8867-4', '2026-01-01T10:00:00.000Z', 66),
          simple('8867-4', '2026-02-01T10:00:00.000Z', 80),
        ],
        hr
      );
      expect(data.map((d) => d.hr)).toEqual([66, 80, 72]);
    });

    test('ignores observations of other codes', () => {
      expect(buildVitalSeries([simple('29463-7', '2026-01-02T10:00:00.000Z', 68)], hr)).toEqual([]);
    });

    test('keeps the newest value when duplicates land in the same minute', () => {
      // The server returns newest first, so the first writer wins.
      const data = buildVitalSeries(
        [simple('8867-4', '2026-01-02T10:00:50.000Z', 90), simple('8867-4', '2026-01-02T10:00:10.000Z', 60)],
        hr
      );
      expect(data).toHaveLength(1);
      expect(data[0].hr).toBe(90);
    });
  });

  describe('getLatestVital and formatVitalValue', () => {
    test('returns the most recent recording', () => {
      const data = buildVitalSeries(
        [bpPanel('2026-01-02T10:00:00.000Z', 120, 80), bpPanel('2026-03-02T10:00:00.000Z', 130, 85)],
        bp
      );
      const latest = getLatestVital(data, bp);
      expect(latest?.values).toEqual({ systolic: 130, diastolic: 85 });
      expect(formatVitalValue(latest, bp)).toBe('130/85');
    });

    test('formats to the metric precision', () => {
      const data = buildVitalSeries([simple('8310-5', '2026-01-02T10:00:00.000Z', 37)], temp);
      expect(formatVitalValue(getLatestVital(data, temp), temp)).toBe('37.0');
    });

    test('renders an em dash when nothing is recorded', () => {
      expect(getLatestVital([], hr)).toBeUndefined();
      expect(formatVitalValue(undefined, hr)).toBe('—');
    });
  });

  describe('filterByRange', () => {
    const data = [
      { time: Date.now() - 400 * 86_400_000, label: 'old' },
      { time: Date.now() - 30 * 86_400_000, label: 'recent' },
    ];

    test('keeps everything for "all"', () => {
      expect(filterByRange(data, 'all')).toHaveLength(2);
    });

    test('trims to the trailing window', () => {
      expect(filterByRange(data, '90').map((d) => d.label)).toEqual(['recent']);
      expect(filterByRange(data, '365').map((d) => d.label)).toEqual(['recent']);
    });
  });
});
