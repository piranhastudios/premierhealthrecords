// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Center, Group, Loader, Stack, Text } from '@mantine/core';
import type { Appointment } from '@medplum/fhirtypes';
import type { JSX, ReactNode } from 'react';
import { useMemo } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { DashboardPanel } from './DashboardPanel';
import { groupByStatus } from './appointmentStatus';

export interface AppointmentsDonutProps {
  appointments: Appointment[] | undefined;
  loading: boolean;
}

/**
 * Donut of today's appointments broken down by status — the real-data
 * replacement for the mockup's "patient risk analytics" panel.
 *
 * @param props - Today's appointments and a loading flag.
 * @returns The donut panel.
 */
export function AppointmentsDonut(props: AppointmentsDonutProps): JSX.Element {
  const { appointments, loading } = props;
  const data = useMemo(() => groupByStatus(appointments ?? []), [appointments]);
  const total = data.reduce((sum, d) => sum + d.value, 0);

  let body: ReactNode;
  if (loading) {
    body = (
      <Center h="100%">
        <Loader />
      </Center>
    );
  } else if (total === 0) {
    body = (
      <Center h="100%">
        <Text c="dimmed" size="sm">
          No appointments scheduled today
        </Text>
      </Center>
    );
  } else {
    body = (
      <Group h="100%" wrap="nowrap" gap="md">
          <div style={{ position: 'relative', width: 160, height: 160, flexShrink: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="label"
                  innerRadius={52}
                  outerRadius={78}
                  paddingAngle={2}
                  stroke="none"
                >
                  {data.map((d) => (
                    <Cell key={d.status} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <Center
              style={{ position: 'absolute', inset: 0, flexDirection: 'column', pointerEvents: 'none' }}
            >
              <Text fw={700} size="xl" lh={1}>
                {total}
              </Text>
              <Text size="xs" c="dimmed">
                Total
              </Text>
            </Center>
          </div>
          <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
            {data.map((d) => (
              <Group key={d.status} gap="xs" wrap="nowrap">
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    backgroundColor: d.color,
                    flexShrink: 0,
                  }}
                />
                <Text size="sm" style={{ flex: 1 }} lineClamp={1}>
                  {d.label}
                </Text>
                <Text size="sm" fw={600}>
                  {d.value}
                </Text>
              </Group>
            ))}
          </Stack>
        </Group>
    );
  }

  return (
    <DashboardPanel title="Appointment Status" subtitle="Today's appointments by status" bodyHeight={260}>
      {body}
    </DashboardPanel>
  );
}
