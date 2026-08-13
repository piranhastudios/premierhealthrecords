// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { Observation } from '@medplum/fhirtypes';

/** One plotted line within a vital-sign metric (e.g. systolic within blood pressure). */
export interface VitalSeriesDef {
  /** Key used for the datum property and the recharts `dataKey`. */
  readonly key: string;
  /** Legend / tooltip label. */
  readonly label: string;
  /** LOINC code(s) of the Observation that carries the value. */
  readonly codes: readonly string[];
  /**
   * LOINC code of the component to read when the value is recorded as a panel
   * (blood pressure). Observations coded directly with this code are also matched,
   * so both panel and standalone recordings are picked up.
   */
  readonly componentCode?: string;
  /** Line color (brand palette hex). */
  readonly color: string;
}

/** A vital sign that can be charted over time. */
export interface VitalMetricDef {
  readonly key: string;
  readonly label: string;
  readonly unit: string;
  /** Decimal places used when formatting values. */
  readonly precision: number;
  readonly series: readonly VitalSeriesDef[];
}

/** LOINC code for the blood pressure panel. */
const BP_PANEL = ['85354-9', '55284-4'];

const BRAND_ORANGE = '#f47b20';
const BRAND_GOLD = '#fdb913';

/**
 * The vitals charted on the patient overview, in display order. Codes mirror the
 * ones written by the vitals form in `@medplum/react` (PatientSummary/Vitals).
 */
export const VITAL_METRICS: readonly VitalMetricDef[] = [
  {
    key: 'bp',
    label: 'Blood Pressure',
    unit: 'mmHg',
    precision: 0,
    series: [
      { key: 'systolic', label: 'Systolic', codes: BP_PANEL, componentCode: '8480-6', color: BRAND_ORANGE },
      { key: 'diastolic', label: 'Diastolic', codes: BP_PANEL, componentCode: '8462-4', color: BRAND_GOLD },
    ],
  },
  {
    key: 'hr',
    label: 'Heart Rate',
    unit: 'bpm',
    precision: 0,
    series: [{ key: 'hr', label: 'Heart Rate', codes: ['8867-4'], color: BRAND_ORANGE }],
  },
  {
    key: 'temp',
    label: 'Temperature',
    unit: '°C',
    precision: 1,
    series: [{ key: 'temp', label: 'Temperature', codes: ['8310-5'], color: BRAND_ORANGE }],
  },
  {
    key: 'rr',
    label: 'Resp. Rate',
    unit: '/min',
    precision: 0,
    series: [{ key: 'rr', label: 'Respiratory Rate', codes: ['9279-1'], color: BRAND_ORANGE }],
  },
  {
    key: 'spo2',
    label: 'Oxygen Sat.',
    unit: '%',
    precision: 0,
    series: [{ key: 'spo2', label: 'Oxygen Saturation', codes: ['2708-6', '59408-5'], color: BRAND_ORANGE }],
  },
  {
    key: 'weight',
    label: 'Weight',
    unit: 'kg',
    precision: 1,
    series: [{ key: 'weight', label: 'Weight', codes: ['29463-7'], color: BRAND_ORANGE }],
  },
  {
    key: 'bmi',
    label: 'BMI',
    unit: 'kg/m²',
    precision: 1,
    series: [{ key: 'bmi', label: 'BMI', codes: ['39156-5'], color: BRAND_ORANGE }],
  },
];

/** A single point on the vitals chart: one timestamp, one value per series. */
export type VitalChartDatum = {
  /** Epoch milliseconds, used for ordering. */
  time: number;
  /** Preformatted x-axis tick label. */
  label: string;
} & Record<string, number | string | undefined>;

/**
 * Returns the clinically relevant timestamp of an observation, in epoch millis.
 *
 * @param obs - The observation.
 * @returns Epoch millis, or undefined when the observation carries no usable date.
 */
export function getObservationTime(obs: Observation): number | undefined {
  const value = obs.effectiveDateTime ?? obs.effectivePeriod?.start ?? obs.issued ?? obs.meta?.lastUpdated;
  if (!value) {
    return undefined;
  }
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? undefined : time;
}

/**
 * Returns true when any of the observation's codings matches one of the codes.
 *
 * @param obs - The observation to test.
 * @param codes - LOINC codes to match against.
 * @returns True when the observation is coded with one of the codes.
 */
function hasCode(obs: Observation, codes: readonly string[]): boolean {
  return obs.code?.coding?.some((coding) => !!coding.code && codes.includes(coding.code)) ?? false;
}

/**
 * Reads the numeric value of a series from an observation, handling both panel
 * observations (blood pressure with systolic/diastolic components) and
 * standalone observations.
 *
 * @param obs - The observation to read.
 * @param series - The series definition describing which code/component to read.
 * @returns The numeric value, or undefined when this observation doesn't carry it.
 */
export function getVitalValue(obs: Observation, series: VitalSeriesDef): number | undefined {
  if (series.componentCode) {
    if (hasCode(obs, series.codes)) {
      const component = obs.component?.find((c) =>
        c.code?.coding?.some((coding) => coding.code === series.componentCode)
      );
      return component?.valueQuantity?.value;
    }
    // Some systems record systolic/diastolic as standalone observations.
    if (hasCode(obs, [series.componentCode])) {
      return obs.valueQuantity?.value;
    }
    return undefined;
  }
  return hasCode(obs, series.codes) ? obs.valueQuantity?.value : undefined;
}

/**
 * Formats a chart tick label for a timestamp.
 *
 * @param time - Epoch millis.
 * @returns A short `12 Mar` style label, with the year appended for prior years.
 */
function formatTickLabel(time: number): string {
  const date = new Date(time);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: '2-digit' }),
  });
}

/**
 * Turns a list of vital-sign observations into chart-ready data for one metric.
 * Observations recorded at the same minute are merged into a single point, so a
 * blood pressure panel (or separate systolic/diastolic resources) yields one datum.
 *
 * @param observations - Vital-sign observations for the patient, in any order.
 * @param metric - The metric to extract.
 * @returns Chart data ordered oldest first; empty when the metric was never recorded.
 */
export function buildVitalSeries(observations: Observation[], metric: VitalMetricDef): VitalChartDatum[] {
  const byMinute = new Map<number, VitalChartDatum>();

  for (const obs of observations) {
    const time = getObservationTime(obs);
    if (time === undefined) {
      continue;
    }
    for (const series of metric.series) {
      const value = getVitalValue(obs, series);
      if (value === undefined) {
        continue;
      }
      const bucket = Math.floor(time / 60_000) * 60_000;
      let datum = byMinute.get(bucket);
      if (!datum) {
        datum = { time: bucket, label: formatTickLabel(bucket) };
        byMinute.set(bucket, datum);
      }
      // First writer wins; observations arrive newest-first from the server.
      datum[series.key] ??= value;
    }
  }

  return Array.from(byMinute.values()).sort((a, b) => a.time - b.time);
}

/** The most recent recording of a metric. */
export interface LatestVital {
  /** Epoch millis of the recording. */
  readonly time: number;
  /** Value per series key; a series missing at that time is absent. */
  readonly values: Record<string, number>;
}

/**
 * Returns the most recent datum for a metric.
 *
 * @param data - Chart data as produced by {@link buildVitalSeries}.
 * @param metric - The metric the data was built for.
 * @returns The latest recording, or undefined when there is no data.
 */
export function getLatestVital(data: VitalChartDatum[], metric: VitalMetricDef): LatestVital | undefined {
  for (let i = data.length - 1; i >= 0; i--) {
    const datum = data[i];
    const values: Record<string, number> = {};
    for (const series of metric.series) {
      const value = datum[series.key];
      if (typeof value === 'number') {
        values[series.key] = value;
      }
    }
    if (Object.keys(values).length > 0) {
      return { time: datum.time, values };
    }
  }
  return undefined;
}

/**
 * Formats the latest reading of a metric for display, joining multi-series
 * metrics with a slash (e.g. `120/80`).
 *
 * @param latest - The latest recording, or undefined.
 * @param metric - The metric being formatted.
 * @returns The formatted value, or `—` when there is nothing to show.
 */
export function formatVitalValue(latest: LatestVital | undefined, metric: VitalMetricDef): string {
  if (!latest) {
    return '—';
  }
  const parts = metric.series
    .map((series) => latest.values[series.key])
    .filter((value): value is number => value !== undefined)
    .map((value) => value.toFixed(metric.precision));
  return parts.length > 0 ? parts.join('/') : '—';
}

/** Selectable windows for the vitals chart. */
export const VITALS_RANGES = [
  { value: '90', label: '3M' },
  { value: '365', label: '1Y' },
  { value: 'all', label: 'All' },
] as const;

/**
 * Filters chart data to a trailing window.
 *
 * @param data - Chart data ordered oldest first.
 * @param range - A day count as a string, or `all`.
 * @returns The filtered data.
 */
export function filterByRange(data: VitalChartDatum[], range: string): VitalChartDatum[] {
  if (range === 'all') {
    return data;
  }
  const days = Number.parseInt(range, 10);
  if (Number.isNaN(days)) {
    return data;
  }
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return data.filter((d) => d.time >= cutoff);
}
