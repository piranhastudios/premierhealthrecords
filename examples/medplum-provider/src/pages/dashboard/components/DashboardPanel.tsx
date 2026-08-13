// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Card, Center, Group, Stack, Text, ThemeIcon } from '@mantine/core';
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
      style={{ backgroundColor: 'var(--phc-surface-card)', borderColor: 'var(--phc-border)' }}
    >
      <Stack gap="sm" h="100%">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <div>
            <Text fw={600}>{title}</Text>
            {subtitle && (
              <Text size="xs" c="dimmed">
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

export interface PanelEmptyStateProps {
  /** Icon shown above the label. */
  icon: ReactNode;
  /** Primary empty-state message. */
  label: string;
  /** Optional secondary hint under the label. */
  hint?: string;
}

/**
 * Centered empty-state for panel bodies — an icon plus a short message, so
 * empty panels read as intentional rather than broken.
 *
 * @param props - Icon, label, and optional hint.
 * @returns The empty-state element.
 */
export function PanelEmptyState(props: PanelEmptyStateProps): JSX.Element {
  const { icon, label, hint } = props;
  return (
    <Center h="100%">
      <Stack gap={6} align="center">
        <ThemeIcon variant="light" color="brand" radius="xl" size={44}>
          {icon}
        </ThemeIcon>
        <Text c="dimmed" size="sm" fw={500}>
          {label}
        </Text>
        {hint && (
          <Text c="dimmed" size="xs">
            {hint}
          </Text>
        )}
      </Stack>
    </Center>
  );
}
