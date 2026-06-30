// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Provider-agnostic inbound email webhook bot (public webhook).
 *
 * Verifies a shared secret, normalizes the provider payload (Resend / Mailgun /
 * SendGrid / SES) into one shape, resolves the patient by email, links the message
 * into the right thread using RFC-5322 In-Reply-To / References, records it
 * idempotently with its email headers, and raises a triage Task for unknown senders.
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
import { createHash } from 'node:crypto';
import type { InboundEmailProvider, NormalizedInboundEmail } from './lib/email-adapters';
import { normalizeInboundEmail } from './lib/email-adapters';
import { IDENTIFIER } from './lib/constants';
import { emailHeadersExtension } from './lib/extensions';
import { verifySharedSecret } from './lib/security';
import { createStaffTask } from './lib/task';
import { createInboundChild, createThreadHeader, findOpenThreadForPatient, findThreadByIdentifier } from './lib/thread';

export async function handler(medplum: MedplumClient, event: BotEvent<any>): Promise<OperationOutcome | Communication> {
  // 1. Authenticate via shared secret.
  const expected = event.secrets['INBOUND_EMAIL_SIGNING_SECRET']?.valueString;
  if (!verifySharedSecret(event, expected)) {
    console.log('Unauthorized inbound email request');
    return unauthorized;
  }

  // 2. Normalize the provider payload.
  const provider = (event.secrets['INBOUND_EMAIL_PROVIDER']?.valueString ?? 'generic') as InboundEmailProvider;
  const email = normalizeInboundEmail(provider, event.input as Record<string, any>);
  const messageId = email.messageId || synthesizeMessageId(email);
  if (!email.from) {
    throw new Error('Inbound email missing sender address');
  }
  const now = new Date().toISOString();

  // 3. Resolve the patient by email.
  const patient = await medplum.searchOne('Patient', { email: email.from });
  const recipients = triageRecipients(event.secrets);

  // 4. Link into a thread.
  const header = await resolveEmailHeader(medplum, email, messageId, patient, recipients);

  // 5. Build payload (sanitized text + attachments) and create the child idempotently.
  const payload = await buildPayload(medplum, email, header.subject as Reference<Patient> | undefined);
  const referencesChain = [...email.references, email.inReplyTo, messageId].filter((s): s is string => !!s);
  const child = await createInboundChild(medplum, {
    header,
    senderRef: patient ? createReference(patient) : undefined,
    payload,
    channel: 'email',
    identifier: { system: IDENTIFIER.emailMessageId, value: messageId },
    extraExtensions: [
      emailHeadersExtension({
        messageId,
        inReplyTo: email.inReplyTo,
        references: [...new Set(referencesChain)].join(' '),
        subject: email.subject,
      }),
    ],
    sentAt: now,
  });

  // 6. Triage Task for unknown senders.
  if (!patient) {
    await createStaffTask(medplum, {
      code: 'triage-message',
      display: 'Unmatched inbound email',
      description: `Inbound email from ${email.from} could not be matched to a patient.`,
      focus: { reference: `Communication/${child.id}` },
      identifier: { system: IDENTIFIER.triageTask, value: messageId },
    });
  }

  return child;
}

async function resolveEmailHeader(
  medplum: MedplumClient,
  email: NormalizedInboundEmail,
  messageId: string,
  patient: Patient | undefined,
  recipients: Reference[]
): Promise<Communication> {
  // 1. Follow the In-Reply-To / References chain to an existing message's thread.
  const ancestorIds = [email.inReplyTo, ...email.references].filter((s): s is string => !!s);
  for (const id of ancestorIds) {
    const priorChild = await medplum.searchOne('Communication', {
      identifier: `${IDENTIFIER.emailMessageId}|${id}`,
    });
    const parentRef = priorChild?.partOf?.[0]?.reference;
    if (parentRef) {
      const parent = await medplum.readResource('Communication', parentRef.split('/')[1]);
      return parent;
    }
  }

  // 2. By thread root identifier.
  const rootId = email.references[0] ?? email.inReplyTo ?? messageId;
  const byRoot = await findThreadByIdentifier(medplum, IDENTIFIER.emailThreadRoot, rootId);
  if (byRoot) {
    return byRoot;
  }

  // 3. Most recent open thread for a known patient.
  if (patient) {
    const open = await findOpenThreadForPatient(medplum, patient.id as string);
    if (open) {
      return open;
    }
  }

  // 4. Create a new triage thread rooted at this message.
  return createThreadHeader(medplum, {
    subject: patient ? createReference(patient) : undefined,
    channel: 'email',
    recipients: patient ? [createReference(patient), ...recipients] : recipients,
    identifier: { system: IDENTIFIER.emailThreadRoot, value: messageId },
    topicText: email.subject || (patient ? undefined : `Unmatched email ${email.from}`),
    triage: true,
  });
}

async function buildPayload(
  medplum: MedplumClient,
  email: NormalizedInboundEmail,
  subject: Reference<Patient> | undefined
): Promise<CommunicationPayload[]> {
  const payload: CommunicationPayload[] = [];
  const text = email.text?.trim() || stripHtml(email.html) || '(empty message)';
  payload.push({ contentString: text });

  for (const att of email.attachments) {
    try {
      let data: Uint8Array | undefined;
      if (att.contentBase64) {
        data = new Uint8Array(Buffer.from(att.contentBase64, 'base64'));
      } else if (att.url) {
        const res = await fetch(att.url);
        if (res.ok) {
          data = new Uint8Array(await res.arrayBuffer());
        }
      }
      if (!data) {
        continue;
      }
      const docRef = await medplum.createDocumentReference({
        data,
        contentType: att.contentType,
        filename: att.filename,
        additionalFields: subject ? { subject } : {},
      });
      payload.push({ contentReference: createReference(docRef) });
    } catch (err) {
      console.error('Failed to import email attachment', err);
    }
  }
  return payload;
}

// Minimal HTML→text fallback when a provider only sends an HTML body.
function stripHtml(html: string | undefined): string {
  if (!html) {
    return '';
  }
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>(?=)/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Deterministic Message-ID for providers that omit one (keeps dedup stable).
function synthesizeMessageId(email: NormalizedInboundEmail): string {
  const hash = createHash('sha1')
    .update(`${email.from}|${email.subject}|${email.text ?? email.html ?? ''}`)
    .digest('hex');
  return `<${hash}@inbound.premierhealth.cm>`;
}

function triageRecipients(secrets: Record<string, ProjectSetting>): Reference[] {
  const ref = secrets['TRIAGE_RECIPIENT']?.valueString;
  return ref ? [{ reference: ref }] : [];
}
