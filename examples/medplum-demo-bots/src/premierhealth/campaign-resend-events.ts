// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Campaign Resend-events webhook bot.
 *
 * Public webhook (`Bot.publicWebhook = true`; register the URL
 * `https://<app-host>/api/webhook/{ProjectMembershipId}` in the Resend
 * dashboard for the email.delivered / opened / clicked / bounced /
 * complained events).
 *
 * Trust model (same as inbound-email.ts): svix signatures can't be verified
 * inside a bot, so the payload is treated as an untrusted hint — before acting
 * we re-fetch the email by id from the Resend API with our own key. If the
 * email doesn't exist on our account, the event is ignored.
 *
 * Actions:
 * - Append the event to the matching Communication (identifier = Resend id)
 *   as an `email-event` extension {type, occurredAt, url?}.
 * - `bounced` / `complained`: NON-NEGOTIABLE suppression — write a deny
 *   marketing Consent, tag the patient `email-suppressed`, and cancel all of
 *   their in-flight campaign enrolments.
 */

import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Communication, Patient, Task } from '@medplum/fhirtypes';
import {
  CONSENT_SCOPE_MARKETING,
  EMAIL_EVENT_EXTENSION,
  RESEND_IDENTIFIER_SYSTEM,
  TASK_CAMPAIGN_ENROLMENT,
  TASK_TYPE_SYSTEM,
  revokeConsent,
  suppressPatient,
} from '@medplum/campaigns';
import { resendApiKeyFromSecrets } from './lib/resend';

/** Resend webhook payload (subset). */
interface ResendEventPayload {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    click?: { link?: string };
  };
}

const EVENT_TYPES: Record<string, string> = {
  'email.delivered': 'delivered',
  'email.opened': 'opened',
  'email.clicked': 'clicked',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
};

export async function handler(medplum: MedplumClient, event: BotEvent<ResendEventPayload>): Promise<any> {
  const payload = event.input;
  const eventType = payload?.type ? EVENT_TYPES[payload.type] : undefined;
  const emailId = payload?.data?.email_id;
  if (!eventType || !emailId) {
    return { skipped: 'not-a-tracked-event' };
  }

  // Verify against our own Resend account before trusting the payload.
  const apiKey = resendApiKeyFromSecrets(event.secrets);
  const verified = await fetch(`https://api.resend.com/emails/${emailId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!verified.ok) {
    console.error(`Resend event for unknown email ${emailId} (${verified.status}); ignoring`);
    return { skipped: 'unverified' };
  }

  const communication = await medplum.searchOne('Communication', [
    ['identifier', `${RESEND_IDENTIFIER_SYSTEM}|${emailId}`],
  ]);
  if (!communication) {
    return { skipped: 'no-matching-communication' };
  }

  // Append the event (idempotent per type+time: skip exact duplicates on redelivery).
  const occurredAt = payload.created_at ?? new Date().toISOString();
  const already = (communication.extension ?? []).some(
    (e) =>
      e.url === EMAIL_EVENT_EXTENSION &&
      e.extension?.some((s) => s.url === 'type' && s.valueCode === eventType) &&
      e.extension?.some((s) => s.url === 'occurredAt' && s.valueDateTime === occurredAt)
  );
  if (!already) {
    await medplum.updateResource<Communication>({
      ...communication,
      extension: [
        ...(communication.extension ?? []),
        {
          url: EMAIL_EVENT_EXTENSION,
          extension: [
            { url: 'type', valueCode: eventType },
            { url: 'occurredAt', valueDateTime: occurredAt },
            ...(payload.data?.click?.link ? [{ url: 'url', valueUrl: payload.data.click.link }] : []),
          ],
        },
      ],
    });
  }

  if (eventType !== 'bounced' && eventType !== 'complained') {
    return { recorded: eventType };
  }

  // Suppression path.
  const patientRef = communication.subject?.reference;
  if (!patientRef?.startsWith('Patient/')) {
    return { recorded: eventType, suppressed: false };
  }
  const patient = await medplum.readReference<Patient>({ reference: patientRef });
  await revokeConsent(medplum, patientRef, CONSENT_SCOPE_MARKETING, `Automatic revocation: email ${eventType}`);
  await suppressPatient(medplum, patient);

  const enrolments = await medplum.searchResources('Task', [
    ['code', `${TASK_TYPE_SYSTEM}|${TASK_CAMPAIGN_ENROLMENT}`],
    ['patient', patientRef],
    ['status', 'in-progress'],
    ['_count', '100'],
  ]);
  for (const enrolment of enrolments) {
    await medplum.updateResource<Task>({
      ...enrolment,
      status: 'cancelled',
      statusReason: { text: `Email ${eventType}` },
    });
  }

  return { recorded: eventType, suppressed: true, cancelledEnrolments: enrolments.length };
}
