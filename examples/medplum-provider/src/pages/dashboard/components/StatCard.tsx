// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Card, Group, Loader, Text } from '@mantine/core';
import { IconArrowUpRight } from '@tabler/icons-react';
import type { JSX, ReactNode } from 'react';
import { Link } from 'react-router';
import classes from './StatCard.module.css';

export interface StatCardProps {
  /** Icon rendered in the tinted circle. */
  icon: ReactNode;
  /** Short metric label, e.g. "Appointments Today". */
  label: string;
  /** The metric value; `undefined` renders a loader, `null`/NaN renders "—". */
  value: number | string | undefined;
  /** Optional secondary text under the value, e.g. "New: 34". */
  sublabel?: string;
  /** Mantine color name for the icon/accent (default: brand). */
  color?: string;
  /** When set, the whole card links here and shows an arrow affordance. */
  href?: string;
  /** Show a loading state regardless of value. */
  loading?: boolean;
}

/**
 * A single dashboard metric tile: tinted icon, label, big value, optional
 * sublabel. Optionally links to a target route. Built on the repo's standard
 * `Card withBorder shadow` convention.
 *
 * @param props - Stat card content and styling.
 * @returns The stat card element.
 */
export function StatCard(props: StatCardProps): JSX.Element {
  const { icon, label, value, sublabel, color = 'brand', href, loading } = props;

  const body = (
    <>
      <span className={classes.badge} data-color={color} aria-hidden>
        {icon}
      </span>
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <div className={classes.headerText}>
          <Text className={classes.label} lineClamp={1}>
            {label}
          </Text>
        </div>
      </Group>
      <Group justify="space-between" align="flex-end" wrap="nowrap" mt="xs">
        <div>
          <Text className={classes.value}>{loading || value === undefined ? <Loader size="sm" /> : value}</Text>
          {sublabel && (
            <Text className={classes.sublabel} lineClamp={1}>
              {sublabel}
            </Text>
          )}
        </div>
        {href && <IconArrowUpRight size={18} className={classes.arrow} />}
      </Group>
    </>
  );

  if (href) {
    return (
      <Card withBorder shadow="sm" radius="md" p="md" component={Link} to={href} className={classes.card}>
        {body}
      </Card>
    );
  }

  return (
    <Card withBorder shadow="sm" radius="md" p="md" className={classes.card}>
      {body}
    </Card>
  );
}
