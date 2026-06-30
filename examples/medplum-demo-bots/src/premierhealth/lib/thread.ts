// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Thread-header lookup and creation shared by the inbound bots, plus an email
 * threading helper used by the outbound bot.
 */

import type { MedplumClient } from '@medplum/core';
import type {
  Communication,
  CommunicationPayload,
  Extension,
  Identifier,
  Patient,
  Reference,
} from '@medplum/fhirtypes';
import type { Channel } from './constants';
import { channelToMedium, TRIAGE_CATEGORY } from './constants';
import type { EmailHeaders } from './extensions';
import { getEmailHeaders, originExtension } from './extensions';

// Statuses that mean a thread is closed and should not receive new inbound messages.
const CLOSED_STATUSES = 'completed,entered-in-error,stopped,unknown';

// Find a thread header by one of its identifiers (e.g. WhatsApp conversation key).
export async function findThreadByIdentifier(
  medplum: MedplumClient,
  system: string,
  value: string
): Promise<Communication | undefined> {
  return medplum.searchOne('Communication', {
    identifier: `${system}|${value}`,
    'part-of:missing': true,
  });
}

// Find the most recently updated open thread header for a patient, if any.
export async function findOpenThreadForPatient(
  medplum: MedplumClient,
  patientId: string
): Promise<Communication | undefined> {
  return medplum.searchOne('Communication', {
    'part-of:missing': true,
    subject: `Patient/${patientId}`,
    'status:not': CLOSED_STATUSES,
    _sort: '-_lastUpdated',
  });
}

export interface CreateHeaderOptions {
  // Omitted for unmatched inbound senders until staff link the patient.
  subject?: Reference<Patient>;
  channel: Channel;
  recipients: Reference[];
  identifier?: Identifier;
  topicText?: string;
  // When true, stamp the shared-triage category so the thread lands in the queue.
  triage?: boolean;
}

// Create a new thread header (the parent Communication with no payload/partOf).
export async function createThreadHeader(medplum: MedplumClient, options: CreateHeaderOptions): Promise<Communication> {
  return medplum.createResource<Communication>({
    resourceType: 'Communication',
    status: 'in-progress',
    ...(options.subject ? { subject: options.subject } : {}),
    recipient: options.recipients as Communication['recipient'],
    medium: [channelToMedium(options.channel)],
    ...(options.identifier ? { identifier: [options.identifier] } : {}),
    ...(options.triage ? { category: [TRIAGE_CATEGORY] } : {}),
    topic: { text: options.topicText ?? defaultTopic(options.channel) },
  });
}

function defaultTopic(channel: Channel): string {
  return channel === 'whatsapp' ? 'WhatsApp conversation' : 'Email conversation';
}

export interface InboundChildOptions {
  header: Communication;
  senderRef?: Communication['sender'];
  payload: CommunicationPayload[];
  channel: Channel;
  // Provider message id used as the idempotency / dedup key.
  identifier: Identifier;
  extraExtensions?: Extension[];
  sentAt: string;
}

// Create an inbound (patient-sent) child Communication, idempotent on the provider
// message id. Always stamps `origin = inbound` so the outbound bot never echoes it.
export async function createInboundChild(medplum: MedplumClient, options: InboundChildOptions): Promise<Communication> {
  const child: Communication = {
    resourceType: 'Communication',
    status: 'in-progress',
    ...(options.senderRef ? { sender: options.senderRef } : {}),
    recipient: options.header.recipient,
    partOf: [{ reference: `Communication/${options.header.id}` }],
    ...(options.header.subject ? { subject: options.header.subject } : {}),
    medium: [channelToMedium(options.channel)],
    sent: options.sentAt,
    received: options.sentAt,
    payload: options.payload,
    identifier: [options.identifier],
    extension: [originExtension('inbound'), ...(options.extraExtensions ?? [])],
  };
  return medplum.createResourceIfNoneExist(
    child,
    `identifier=${options.identifier.system}|${options.identifier.value}`
  );
}

// Find the email headers of the most recent email message in a thread, used to
// build `In-Reply-To` / `References` for the next outbound email.
export async function findLatestEmailHeaders(
  medplum: MedplumClient,
  threadId: string
): Promise<EmailHeaders | undefined> {
  const children = await medplum.searchResources('Communication', {
    'part-of': `Communication/${threadId}`,
    _sort: '-sent',
    _count: '30',
  });
  for (const child of children) {
    const headers = getEmailHeaders(child);
    if (headers?.messageId) {
      return headers;
    }
  }
  return undefined;
}
