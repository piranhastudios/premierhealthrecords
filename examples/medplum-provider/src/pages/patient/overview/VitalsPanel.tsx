// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Box, Center, Group, Loader, SegmentedControl, SimpleGrid, Stack, Text, UnstyledButton } from '@mantine/core';
import type { Observation } from '@medplum/fhirtypes';
import type { JSX } from 'react';
import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { DashboardPanel } from '../../dashboard/components/DashboardPanel';
import classes from './VitalsPanel.module.css';
import type { VitalMetricDef } from './vitals.utils';
import {
  buildVitalSeries,
  filterByRange,
  formatVitalValue,
  getLatestVital,
  VITAL_METRICS,
  VITALS_RANGES,
} from './vitals.utils';

const CHART_HEIGHT = 240;

export interface VitalsPanelProps {
  /** Vital-sign observations for the patient, newest first. */
  readonly observations: Observation[] | undefined;
  readonly loading: boolean;
}

/**
 * Latest vitals as selectable tiles, with a trend chart for whichever vital is
 * selected. Tiles double as the chart's metric picker so the whole panel reads
 * as one control.
 *
 * @param props - The patient's vital-sign observations and a loading flag.
 * @returns The vitals panel.
 */
export function VitalsPanel(props: VitalsPanelProps): JSX.Element {
  const { observations, loading } = props;
  const [selectedKey, setSelectedKey] = useState<string>(VITAL_METRICS[0].key);
  const [range, setRange] = useState<string>('365');

  // One pass over the observations builds every metric's series up front; the
  // tiles need the latest value for all of them anyway.
  const seriesByMetric = useMemo(() => {
    const result = new Map<string, ReturnType<typeof buildVitalSeries>>();
    for (const metric of VITAL_METRICS) {
      result.set(metric.key, buildVitalSeries(observations ?? [], metric));
    }
    return result;
  }, [observations]);

  const selected = VITAL_METRICS.find((m) => m.key === selectedKey) ?? VITAL_METRICS[0];
  const selectedData = useMemo(
    () => filterByRange(seriesByMetric.get(selected.key) ?? [], range),
    [seriesByMetric, selected.key, range]
  );

  const recorded = VITAL_METRICS.some((m) => (seriesByMetric.get(m.key)?.length ?? 0) > 0);

  return (
    <DashboardPanel
      title="Vitals"
      subtitle={loading ? 'Loading…' : `${selected.label} over time`}
      action={
        <SegmentedControl
          size="xs"
          value={range}
          onChange={setRange}
          data={VITALS_RANGES as unknown as { value: string; label: string }[]}
        />
      }
    >
      <Stack gap="md" h="100%">
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
          {VITAL_METRICS.map((metric) => (
            <VitalTile
              key={metric.key}
              metric={metric}
              data={seriesByMetric.get(metric.key) ?? []}
              selected={metric.key === selected.key}
              onSelect={setSelectedKey}
            />
          ))}
        </SimpleGrid>

        <Box h={CHART_HEIGHT}>
          {loading && (
            <Center h="100%">
              <Loader />
            </Center>
          )}
          {!loading && selectedData.length === 0 && (
            <Center h="100%">
              <Text size="sm" c="dimmed" ta="center">
                {recorded
                  ? `No ${selected.label.toLowerCase()} recorded in this period`
                  : 'No vitals recorded for this patient yet'}
              </Text>
            </Center>
          )}
          {!loading && selectedData.length > 0 && <VitalsChart metric={selected} data={selectedData} />}
        </Box>
      </Stack>
    </DashboardPanel>
  );
}

interface VitalTileProps {
  readonly metric: VitalMetricDef;
  readonly data: ReturnType<typeof buildVitalSeries>;
  readonly selected: boolean;
  readonly onSelect: (key: string) => void;
}

/**
 * A single latest-reading tile that also selects the metric for the chart.
 *
 * @param props - Tile inputs.
 * @param props.metric - The metric this tile summarises.
 * @param props.data - The metric's chart data.
 * @param props.selected - Whether this metric is the one being charted.
 * @param props.onSelect - Called with the metric key when the tile is clicked.
 * @returns The tile.
 */
function VitalTile({ metric, data, selected, onSelect }: VitalTileProps): JSX.Element {
  const latest = getLatestVital(data, metric);
  return (
    <UnstyledButton
      className={classes.tile}
      data-selected={selected || undefined}
      data-empty={!latest || undefined}
      onClick={() => onSelect(metric.key)}
      aria-pressed={selected}
    >
      <Text size="xs" c="dark.2" lineClamp={1}>
        {metric.label}
      </Text>
      <Group gap={4} align="baseline" wrap="nowrap">
        <Text fw={700} size="lg" lh={1.2}>
          {formatVitalValue(latest, metric)}
        </Text>
        {latest && (
          <Text size="xs" c="dark.2">
            {metric.unit}
          </Text>
        )}
      </Group>
      <Text size="xs" c="dark.3" lineClamp={1}>
        {latest ? new Date(latest.time).toLocaleDateString() : 'Not recorded'}
      </Text>
    </UnstyledButton>
  );
}

interface VitalsChartProps {
  readonly metric: VitalMetricDef;
  readonly data: ReturnType<typeof buildVitalSeries>;
}

/**
 * Line chart of one vital over time. Multi-series metrics (blood pressure) plot
 * one line per component.
 *
 * @param props - Chart inputs.
 * @param props.metric - The metric being charted.
 * @param props.data - The chart data, oldest first.
 * @returns The chart.
 */
function VitalsChart({ metric, data }: VitalsChartProps): JSX.Element {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--mantine-color-dark-5)" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} minTickGap={16} />
        <YAxis
          tickLine={false}
          axisLine={false}
          fontSize={11}
          width={44}
          domain={['auto', 'auto']}
          unit={metric.unit === '%' ? '%' : undefined}
        />
        <Tooltip
          formatter={(value) => `${value} ${metric.unit}`}
          contentStyle={{
            background: 'var(--mantine-color-dark-6)',
            border: '1px solid var(--mantine-color-dark-4)',
            borderRadius: 12,
            fontSize: 12,
          }}
          labelStyle={{ color: 'var(--mantine-color-dark-0)' }}
          itemStyle={{ color: 'var(--mantine-color-dark-0)' }}
          cursor={{ stroke: 'var(--mantine-color-dark-4)' }}
        />
        {metric.series.map((series) => (
          <Line
            key={series.key}
            type="monotone"
            dataKey={series.key}
            name={series.label}
            stroke={series.color}
            strokeWidth={2}
            dot={{ r: 2.5, strokeWidth: 0, fill: series.color }}
            activeDot={{ r: 4 }}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
