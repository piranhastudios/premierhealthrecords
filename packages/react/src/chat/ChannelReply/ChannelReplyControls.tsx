// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Badge, Group } from '@mantine/core';
import { IconBrandWhatsapp, IconMail } from '@tabler/icons-react';
import type { JSX } from 'react';
import type { MessagingChannel, SelectedTemplate } from './constants';
import { TemplatePicker } from './TemplatePicker';

export interface ChannelReplyControlsProps {
  readonly channel: MessagingChannel;
  /** Called when a WhatsApp template is chosen and ready to send. */
  readonly onSendTemplate: (template: SelectedTemplate) => void;
}

// Accessory row rendered above the reply input: a channel chip plus, for WhatsApp,
// the approved-template picker. Passed to `BaseChat` via the `inputAccessory` slot.
export function ChannelReplyControls(props: ChannelReplyControlsProps): JSX.Element {
  const whatsapp = props.channel === 'whatsapp';
  return (
    <Group gap="xs" px="md" pt={6} justify="space-between" wrap="nowrap">
      <Badge
        variant="light"
        color={whatsapp ? 'teal' : 'blue'}
        leftSection={whatsapp ? <IconBrandWhatsapp size={12} /> : <IconMail size={12} />}
      >
        {whatsapp ? 'WhatsApp' : 'Email'}
      </Badge>
      {whatsapp && <TemplatePicker onSend={props.onSendTemplate} />}
    </Group>
  );
}
