// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Card, Group, Stack, Text } from '@mantine/core';
import type { JSX, ReactNode } from 'react';

export interface DashboardPanelProps {
  /** Panel heading. */
  title: string;
  /** Optional muted subtitle under the title. */
  subtitle?: string;
  /** Optional element rendered on the right of the header (link/action). */
  action?: ReactNode;
  /** Panel body. */
  children: ReactNode;
  /** Optional fixed body height (px) — used for the calendar/scroll panels. */
  bodyHeight?: number;
}

/**
 * Consistent titled card used to frame every dashboard widget (charts, lists,
 * calendar). Matches the repo's `Card withBorder shadow` convention.
 *
 * @param props - Title, optional subtitle/action, and body content.
 * @returns The framed panel.
 */
export function DashboardPanel(props: DashboardPanelProps): JSX.Element {
  const { title, subtitle, action, children, bodyHeight } = props;
  return (
    <Card
      withBorder
      shadow="sm"
      radius="lg"
      p="md"
      h="100%"
      bg="dark.7"
      style={{ borderColor: 'var(--mantine-color-dark-4)' }}
    >
      <Stack gap="sm" h="100%">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <div>
            <Text fw={600}>{title}</Text>
            {subtitle && (
              <Text size="xs" c="dark.2">
                {subtitle}
              </Text>
            )}
          </div>
          {action}
        </Group>
        <div style={bodyHeight ? { height: bodyHeight } : { flex: 1, minHeight: 0 }}>{children}</div>
      </Stack>
    </Card>
  );
}
