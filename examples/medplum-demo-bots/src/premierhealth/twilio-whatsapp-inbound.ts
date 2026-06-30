// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Inbound Twilio WhatsApp webhook bot (public webhook).
 *
 * Validates the Twilio signature, resolves the patient by phone, links the message
 * into the right thread (creating a triage thread if none exists or the sender is
 * unknown), records it idempotently, and refreshes the header's 24h service window.
 */

import { createReference, unauthorized } from '@medplum/core';
import type { BotEvent, MedplumClient } from '@medplum/core';
import type {
  Communication,
  CommunicationPayload,
  OperationOutcome,
  Patient,
  ProjectSetting,
  Reference,
} from '@medplum/fhirtypes';
import { validateRequest } from 'twilio/lib/webhooks/webhooks';
import { IDENTIFIER } from './lib/constants';
import { whatsappWindowExtension } from './lib/extensions';
import { normalizeE164, stripWhatsappPrefix } from './lib/phone';
import { createStaffTask } from './lib/task';
import { createInboundChild, createThreadHeader, findOpenThreadForPatient, findThreadByIdentifier } from './lib/thread';
import { downloadTwilioMedia, getBotWebhookUrl, twilioConfigFromSecrets } from './lib/twilio';

export async function handler(medplum: MedplumClient, event: BotEvent<any>): Promise<OperationOutcome | Communication> {
  // 1. Validate the Twilio signature (this endpoint is unauthenticated).
  const webhookUrl = await getBotWebhookUrl(medplum, event);
  const signature = event.headers?.['x-twilio-signature'] as string;
  const authToken = event.secrets['TWILIO_AUTH_TOKEN']?.valueString as string;
  const params = Object.fromEntries(Object.entries(event.input)) as Record<string, string>;
  if (!validateRequest(authToken, signature, webhookUrl, params)) {
    console.log('Unauthorized WhatsApp webhook request');
    return unauthorized;
  }

  const messageSid = params.MessageSid ?? params.SmsMessageSid;
  if (!messageSid) {
    throw new Error('WhatsApp webhook missing MessageSid');
  }
  const e164 = normalizeE164(stripWhatsappPrefix(params.From ?? ''));
  const body = params.Body ?? '';
  const now = new Date().toISOString();

  // 2. Resolve the patient by phone.
  const patient = await medplum.searchOne('Patient', { phone: e164 });
  const recipients = triageRecipients(event.secrets);

  // 3. Find or create the thread header.
  const header = await resolveHeader(medplum, e164, patient, recipients);

  // 4. Build attachments (if any) then create the inbound child idempotently.
  const payload = await buildPayload(
    medplum,
    event.secrets,
    params,
    body,
    header.subject as Reference<Patient> | undefined
  );
  const child = await createInboundChild(medplum, {
    header,
    senderRef: patient ? createReference(patient) : undefined,
    payload,
    channel: 'whatsapp',
    identifier: { system: IDENTIFIER.twilioMessage, value: messageSid },
    sentAt: now,
  });

  // 5. Refresh the WhatsApp 24h service window on the header.
  const freshHeader = await medplum.readResource('Communication', header.id as string);
  await medplum.updateResource({
    ...freshHeader,
    extension: [
      ...(freshHeader.extension ?? []).filter((e) => e.url !== whatsappWindowExtension(now).url),
      whatsappWindowExtension(now),
    ],
  });

  // 6. Raise a triage Task for unknown senders so staff can link the patient.
  if (!patient) {
    await createStaffTask(medplum, {
      code: 'triage-message',
      display: 'Unmatched inbound WhatsApp message',
      description: `Inbound WhatsApp from ${e164} could not be matched to a patient.`,
      focus: { reference: `Communication/${child.id}` },
      identifier: { system: IDENTIFIER.triageTask, value: messageSid },
    });
  }

  return child;
}

async function resolveHeader(
  medplum: MedplumClient,
  e164: string,
  patient: Patient | undefined,
  recipients: Reference[]
): Promise<Communication> {
  // Prefer the stable WhatsApp conversation key.
  const byConversation = await findThreadByIdentifier(medplum, IDENTIFIER.whatsappConversation, e164);
  if (byConversation) {
    return byConversation;
  }
  // Else the most recent open thread for a known patient.
  if (patient) {
    const open = await findOpenThreadForPatient(medplum, patient.id as string);
    if (open) {
      return open;
    }
  }
  // Else create a new triage thread keyed by the conversation number.
  return createThreadHeader(medplum, {
    subject: patient ? createReference(patient) : undefined,
    channel: 'whatsapp',
    recipients: patient ? [createReference(patient), ...recipients] : recipients,
    identifier: { system: IDENTIFIER.whatsappConversation, value: e164 },
    topicText: patient ? undefined : `Unmatched WhatsApp ${e164}`,
    triage: true,
  });
}

async function buildPayload(
  medplum: MedplumClient,
  secrets: Record<string, ProjectSetting>,
  params: Record<string, string>,
  body: string,
  subject: Reference<Patient> | undefined
): Promise<CommunicationPayload[]> {
  const payload: CommunicationPayload[] = [];
  if (body) {
    payload.push({ contentString: body });
  }
  const numMedia = parseInt(params.NumMedia ?? '0', 10);
  if (numMedia > 0) {
    const config = twilioConfigFromSecrets(secrets);
    for (let i = 0; i < numMedia; i++) {
      const url = params[`MediaUrl${i}`];
      if (!url) {
        continue;
      }
      try {
        const media = await downloadTwilioMedia(config, url);
        const docRef = await medplum.createDocumentReference({
          data: new Uint8Array(media.data),
          contentType: media.contentType,
          filename: `whatsapp-media-${i}`,
          additionalFields: subject ? { subject } : {},
        });
        payload.push({ contentReference: createReference(docRef) });
      } catch (err) {
        console.error('Failed to import WhatsApp media', err);
      }
    }
  }
  // Guarantee at least one payload entry so the message renders.
  if (payload.length === 0) {
    payload.push({ contentString: '(empty message)' });
  }
  return payload;
}

function triageRecipients(secrets: Record<string, ProjectSetting>): Reference[] {
  const ref = secrets['TRIAGE_RECIPIENT']?.valueString;
  return ref ? [{ reference: ref }] : [];
}
