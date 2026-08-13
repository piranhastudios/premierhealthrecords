// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Badge, Group, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconSparkles } from '@tabler/icons-react';
import type { JSX } from 'react';
import { DashboardPanel } from './DashboardPanel';

/**
 * Placeholder for AI-driven patient-risk analytics (planned Vertex AI work).
 * Deliberately shows no fabricated numbers — it explains what's coming and is
 * clearly labeled as not yet available.
 *
 * @returns The AI insights placeholder panel.
 */
export function AiInsightsStub(): JSX.Element {
  return (
    <DashboardPanel
      title="AI Insights"
      subtitle="Predictive risk analytics"
      action={
        <Badge color="brandGold" variant="light" size="sm">
          Coming soon
        </Badge>
      }
      bodyHeight={200}
    >
      <Stack align="center" justify="center" h="100%" gap="sm">
        <ThemeIcon variant="light" color="brand" radius="xl" size={48}>
          <IconSparkles size={26} />
        </ThemeIcon>
        <Group justify="center">
          <Text size="sm" c="dimmed" ta="center" maw={320}>
            Patient risk stratification and early-warning insights will appear here once the clinical AI model is
            connected.
          </Text>
        </Group>
      </Stack>
    </DashboardPanel>
  );
}
