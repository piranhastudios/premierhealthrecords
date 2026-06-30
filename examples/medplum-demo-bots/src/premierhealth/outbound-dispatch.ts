// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Outbound dispatch bot.
 *
 * Triggered by a Subscription on `Communication?part-of:missing=false` scoped (via
 * a FHIRPath criteria extension) to staff-sent messages on create only. It delivers
 * the staff message to the patient over the thread's chosen channel (WhatsApp via
 * Twilio, or email via Resend) and writes the provider message id + delivery status
 * back onto the Communication.
 *
 * Loop prevention (three independent guards):
 *  1. The Subscription FHIRPath only matches `sender = Practitioner/...`.
 *  2. The Subscription is create-only, so this bot's own write-back (an update)
 *     never re-triggers it.
 *  3. This handler returns early for Patient senders or `origin = inbound` messages.
 */

import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Communication, Patient, Reference } from '@medplum/fhirtypes';
import { resolvePatientEndpoint } from './lib/channel-resolver';
import { IDENTIFIER, mediumToChannel } from './lib/constants';
import {
  emailHeadersExtension,
  getDeliveryStatus,
  getOrigin,
  getWhatsappTemplate,
  originExtension,
  setDeliveryStatus,
  upsertExtension,
  upsertIdentifier,
} from './lib/extensions';
import { buildReplyHeaders, generateMessageId, resendConfigFromSecrets, sendEmail } from './lib/resend';
import { createStaffTask } from './lib/task';
import { findLatestEmailHeaders } from './lib/thread';
import { sendWhatsApp, twilioConfigFromSecrets } from './lib/twilio';

export async function handler(medplum: MedplumClient, event: BotEvent<Communication>): Promise<any> {
  const message = event.input;

  // Guard: never act on inbound (patient-sent) messages.
  if (message.sender?.reference?.startsWith('Patient/') || getOrigin(message) === 'inbound') {
    return { skipped: 'inbound' };
  }
  // Guard: only child messages (must belong to a thread).
  const headerRef = message.partOf?.[0];
  if (!headerRef?.reference) {
    return { skipped: 'not-a-thread-message' };
  }
  // Guard: idempotency — don't re-send something already sent/delivered/read.
  const existingStatus = getDeliveryStatus(message);
  if (existingStatus && existingStatus !== 'queued' && existingStatus !== 'failed') {
    return { skipped: `already-${existingStatus}` };
  }

  const header = await medplum.readReference(headerRef as Reference<Communication>);
  const channel = mediumToChannel(header.medium) ?? mediumToChannel(message.medium);
  if (!channel) {
    await markFailure(medplum, message, 'undeliverable', 'No channel set on thread', header.subject);
    return { error: 'no-channel' };
  }

  const patient = header.subject ? await medplum.readReference(header.subject as Reference<Patient>) : undefined;
  if (patient?.resourceType !== 'Patient') {
    await markFailure(medplum, message, 'undeliverable', 'Thread has no patient subject', header.subject);
    return { error: 'no-patient' };
  }

  const endpoint = resolvePatientEndpoint(patient, channel);
  if (!endpoint) {
    await markFailure(
      medplum,
      message,
      'undeliverable',
      `Patient has no ${channel === 'whatsapp' ? 'phone number' : 'email address'}`,
      header.subject
    );
    return { error: 'no-endpoint' };
  }

  const text = message.payload?.find((p) => p.contentString)?.contentString ?? '';

  try {
    if (channel === 'whatsapp') {
      await dispatchWhatsApp(medplum, event, message, endpoint, text);
    } else {
      await dispatchEmail(medplum, event, message, header, endpoint, text);
    }
    return { status: 'sent', channel };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await markFailure(medplum, message, 'failed', reason, header.subject);
    return { error: reason } satisfies Record<string, string>;
  }
}

async function dispatchWhatsApp(
  medplum: MedplumClient,
  event: BotEvent<Communication>,
  message: Communication,
  to: string,
  text: string
): Promise<void> {
  const config = twilioConfigFromSecrets(event.secrets);
  const statusCallback = event.secrets['TWILIO_STATUS_CALLBACK_URL']?.valueString;
  const template = getWhatsappTemplate(message);
  if (!template && !text) {
    throw new Error('WhatsApp message has no text or template');
  }
  const result = await sendWhatsApp(config, {
    to,
    ...(template ? { contentSid: template.sid, contentVariables: template.vars } : { body: text }),
    ...(statusCallback ? { statusCallback } : {}),
  });
  await writeBackSuccess(medplum, message.id as string, IDENTIFIER.twilioMessage, result.sid);
}

async function dispatchEmail(
  medplum: MedplumClient,
  event: BotEvent<Communication>,
  message: Communication,
  header: Communication,
  to: string,
  text: string
): Promise<void> {
  if (!text) {
    throw new Error('Email message has no body');
  }
  const config = resendConfigFromSecrets(event.secrets);
  const previous = await findLatestEmailHeaders(medplum, header.id as string);
  const messageId = generateMessageId(config.from);
  const replyHeaders = buildReplyHeaders(messageId, previous);
  const subject = withRePrefix(previous?.subject ?? header.topic?.text ?? 'Message from Premier Health');

  await sendEmail(config, {
    to,
    subject,
    text,
    headers: {
      'Message-ID': messageId,
      ...(replyHeaders.inReplyTo ? { 'In-Reply-To': replyHeaders.inReplyTo } : {}),
      ...(replyHeaders.references ? { References: replyHeaders.references } : {}),
    },
  });

  // Write back identifier + delivery status + the email headers we sent (for future threading).
  const fresh = await medplum.readResource('Communication', message.id as string);
  const now = new Date().toISOString();
  let extension = setDeliveryStatus(fresh.extension, 'sent', now);
  extension = upsertExtension(extension, originExtension('outbound'));
  extension = upsertExtension(
    extension,
    emailHeadersExtension({
      messageId,
      inReplyTo: replyHeaders.inReplyTo,
      references: replyHeaders.references,
      subject,
    })
  );
  await medplum.updateResource({
    ...fresh,
    identifier: upsertIdentifier(fresh.identifier, { system: IDENTIFIER.emailMessageId, value: messageId }),
    extension,
  });
}

// Stamp a successful send (identifier + delivery-status sent + origin outbound).
async function writeBackSuccess(
  medplum: MedplumClient,
  messageId: string,
  identifierSystem: string,
  identifierValue: string
): Promise<void> {
  const fresh = await medplum.readResource('Communication', messageId);
  const now = new Date().toISOString();
  let extension = setDeliveryStatus(fresh.extension, 'sent', now);
  extension = upsertExtension(extension, originExtension('outbound'));
  await medplum.updateResource({
    ...fresh,
    identifier: upsertIdentifier(fresh.identifier, { system: identifierSystem, value: identifierValue }),
    extension,
  });
}

// Record a delivery failure on the message and raise a staff Task.
async function markFailure(
  medplum: MedplumClient,
  message: Communication,
  status: 'failed' | 'undeliverable',
  reason: string,
  patientRef: Reference | undefined
): Promise<void> {
  const fresh = await medplum.readResource('Communication', message.id as string);
  const now = new Date().toISOString();
  await medplum.updateResource({
    ...fresh,
    extension: setDeliveryStatus(fresh.extension, status, now, reason),
  });
  await createStaffTask(medplum, {
    code: 'delivery-failed',
    display: 'Message delivery failed',
    description: `Could not deliver message: ${reason}`,
    focus: { reference: `Communication/${message.id}` },
    forRef: patientRef,
    identifier: { system: IDENTIFIER.deliveryTask, value: message.id as string },
  });
}

function withRePrefix(subject: string): string {
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
}
