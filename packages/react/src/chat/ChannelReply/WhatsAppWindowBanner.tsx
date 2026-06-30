// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Group, Text } from '@mantine/core';
import { IconClockHour4 } from '@tabler/icons-react';
import type { JSX } from 'react';
import { getWhatsappWindowState } from './constants';

export interface WhatsAppWindowBannerProps {
  /** ISO instant when the 24h free-form window closes; undefined means never opened. */
  readonly expiresAt: string | undefined;
}

// Compact indicator of the WhatsApp 24h customer-service window. Green when staff
// can still send free-form replies; orange when only approved templates are allowed.
export function WhatsAppWindowBanner(props: WhatsAppWindowBannerProps): JSX.Element {
  const { open, hoursLeft } = getWhatsappWindowState(props.expiresAt);
  const color = open ? 'green' : 'orange';

  return (
    <Group gap={6} px="md" py={6} bg={`var(--mantine-color-${color}-0)`} wrap="nowrap">
      <IconClockHour4 size={14} color={`var(--mantine-color-${color}-7)`} />
      <Text size="xs" c={`${color}.8`} fw={500}>
        {open
          ? `WhatsApp window open — about ${hoursLeft}h left for free-form replies`
          : 'WhatsApp 24h window closed — only approved templates can be sent'}
      </Text>
    </Group>
  );
}
