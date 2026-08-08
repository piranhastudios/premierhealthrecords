// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { SimpleGrid } from '@mantine/core';
import type { JSX } from 'react';
import type { StatCardProps } from './StatCard';
import { StatCard } from './StatCard';

export interface StatCardRowProps {
  /** The resolved stat tiles to render. Fetch counts in the parent and pass them here. */
  stats: StatCardProps[];
}

/**
 * Responsive row of dashboard stat tiles. The number of columns adapts from 1
 * (mobile) up to 5 (wide), matching the reference dashboard's KPI row.
 *
 * @param props - The list of stat tiles.
 * @returns The stat card grid.
 */
export function StatCardRow(props: StatCardRowProps): JSX.Element {
  const { stats } = props;
  return (
    <SimpleGrid cols={{ base: 1, xs: 2, sm: 3, lg: stats.length >= 5 ? 5 : 4 }} spacing="md">
      {stats.map((stat) => (
        <StatCard key={stat.label} {...stat} />
      ))}
    </SimpleGrid>
  );
}
