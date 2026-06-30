// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Twilio message status callback bot (public webhook).
 *
 * Twilio POSTs delivery lifecycle events (sent / delivered / read / failed) here.
 * The bot looks up the outbound child Communication by its Twilio message SID and
 * advances its delivery-status extension. It never creates Communications, so it
 * cannot participate in any messaging loop.
 */

import { unauthorized } from '@medplum/core';
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { OperationOutcome } from '@medplum/fhirtypes';
import type { DeliveryStatus } from './lib/constants';
import { IDENTIFIER } from './lib/constants';
import { setDeliveryStatus } from './lib/extensions';
import { getBotWebhookUrl } from './lib/twilio';
import { validateRequest } from 'twilio/lib/webhooks/webhooks';

const STATUS_MAP: Record<string, DeliveryStatus> = {
  queued: 'queued',
  sending: 'sent',
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  failed: 'failed',
  undelivered: 'undeliverable',
};

export async function handler(
  medplum: MedplumClient,
  event: BotEvent<any>
): Promise<OperationOutcome | { status: string }> {
  const webhookUrl = await getBotWebhookUrl(medplum, event);
  const signature = event.headers?.['x-twilio-signature'] as string;
  const authToken = event.secrets['TWILIO_AUTH_TOKEN']?.valueString as string;
  const params = Object.fromEntries(Object.entries(event.input)) as Record<string, string>;
  if (!validateRequest(authToken, signature, webhookUrl, params)) {
    return unauthorized;
  }

  const sid = params.MessageSid ?? params.SmsSid;
  const twilioStatus = (params.MessageStatus ?? params.SmsStatus ?? '').toLowerCase();
  const mapped = STATUS_MAP[twilioStatus];
  if (!sid || !mapped) {
    return { status: 'ignored' };
  }

  const message = await medplum.searchOne('Communication', {
    identifier: `${IDENTIFIER.twilioMessage}|${sid}`,
  });
  if (!message) {
    return { status: 'not-found' };
  }

  const now = new Date().toISOString();
  const error = params.ErrorCode ? `Twilio error ${params.ErrorCode}` : undefined;
  await medplum.updateResource({
    ...message,
    extension: setDeliveryStatus(message.extension, mapped, now, error),
  });
  return { status: mapped };
}
