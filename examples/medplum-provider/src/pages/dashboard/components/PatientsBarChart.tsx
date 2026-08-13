// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Center, Loader } from '@mantine/core';
import { useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { startOfDaysAgo } from '../../../hooks/useDashboardMetrics';
import { DashboardPanel } from './DashboardPanel';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WINDOW_DAYS = 7;

interface DayBucket {
  key: string;
  label: string;
  count: number;
}

/**
 * Builds an ordered list of the last `WINDOW_DAYS` day buckets (oldest first).
 * @returns Zeroed day buckets for the trailing window.
 */
function buildBuckets(): DayBucket[] {
  const buckets: DayBucket[] = [];
  const now = new Date();
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    d.setHours(0, 0, 0, 0);
    buckets.push({ key: d.toDateString(), label: DAY_LABELS[d.getDay()], count: 0 });
  }
  return buckets;
}

/**
 * Bar chart of appointment volume per day over the last 7 days — the real-data
 * "patient statistics" panel. Fetches its own window (distinct from today's data).
 *
 * @returns The bar chart panel.
 */
export function PatientsBarChart(): JSX.Element {
  const medplum = useMedplum();
  const [data, setData] = useState<DayBucket[] | undefined>(undefined);

  useEffect(() => {
    let active = true;
    medplum
      .searchResources('Appointment', [
        ['_count', '1000'],
        ['date', `ge${startOfDaysAgo(WINDOW_DAYS - 1)}`],
        ['_sort', 'date'],
      ])
      .then((appointments) => {
        if (!active) {
          return;
        }
        const buckets = buildBuckets();
        const byKey = new Map(buckets.map((b) => [b.key, b]));
        for (const appt of appointments) {
          if (!appt.start) {
            continue;
          }
          const key = new Date(appt.start).toDateString();
          const bucket = byKey.get(key);
          if (bucket) {
            bucket.count += 1;
          }
        }
        setData(buckets);
      })
      .catch(() => active && setData(buildBuckets()));
    return () => {
      active = false;
    };
  }, [medplum]);

  const content = useMemo(() => {
    if (!data) {
      return (
        <Center h="100%">
          <Loader />
        </Center>
      );
    }
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--mantine-color-gray-3)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} width={32} />
          <Tooltip cursor={{ fill: 'rgba(244,123,32,0.08)' }} />
          <Bar dataKey="count" name="Appointments" fill="#f47b20" radius={[4, 4, 0, 0]} maxBarSize={48} />
        </BarChart>
      </ResponsiveContainer>
    );
  }, [data]);

  return (
    <DashboardPanel title="Appointment Volume" subtitle="Last 7 days" bodyHeight={260}>
      {content}
    </DashboardPanel>
  );
}
