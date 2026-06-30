// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Shared identifiers, coding systems, and extension URLs for the Premier Health
 * patient <-> staff messaging bridge (WhatsApp via Twilio + email via Resend/generic).
 *
 * Kept in one place so the inbound, outbound, and status-callback bots agree on the
 * exact wire format used on `Communication` resources. The UI mirrors the channel
 * subset in `packages/react/src/chat/ChannelReply/constants.ts`.
 */

import type { CodeableConcept } from '@medplum/fhirtypes';

export const PH_BASE = 'https://premierhealth.cm/fhir';

// HL7 v3 ParticipationMode — standard system used for the email medium.
export const V3_PARTICIPATION_MODE = 'http://terminology.hl7.org/CodeSystem/v3-ParticipationMode';

// Project-defined CodeSystems.
export const SYSTEM = {
  // Communication channel (WhatsApp). Email uses the v3 ParticipationMode system.
  channel: `${PH_BASE}/CodeSystem/communication-channel`,
  // Thread triage state, stamped on a header when it lands in the shared queue.
  threadStatus: `${PH_BASE}/CodeSystem/thread-status`,
  // WhatsApp template catalog type.
  templateType: `${PH_BASE}/CodeSystem/template-type`,
  // Task codes for staff work queues.
  taskCodes: `${PH_BASE}/CodeSystem/task-codes`,
} as const;

// Identifier systems used for dedup and thread keys.
export const IDENTIFIER = {
  // Twilio message SID, on each outbound/inbound WhatsApp child Communication.
  twilioMessage: `${PH_BASE}/sid/twilio-message`,
  // RFC-5322 Message-ID, on each email child Communication.
  emailMessageId: `${PH_BASE}/sid/email-message-id`,
  // Stable WhatsApp conversation key (patient E.164), on the thread header.
  whatsappConversation: `${PH_BASE}/sid/whatsapp-conversation`,
  // Root email Message-ID for a thread, on the thread header.
  emailThreadRoot: `${PH_BASE}/sid/email-thread-root`,
  // Twilio Content API content SID, on a WhatsApp template catalog entry.
  twilioContent: `${PH_BASE}/sid/twilio-content`,
  // Idempotency key for a delivery-failure Task (keyed by message id).
  deliveryTask: `${PH_BASE}/sid/delivery-task`,
  // Idempotency key for an inbound-triage Task (keyed by provider message id).
  triageTask: `${PH_BASE}/sid/triage-task`,
} as const;

// Extension URLs.
export const EXT = {
  deliveryStatus: `${PH_BASE}/StructureDefinition/delivery-status`,
  deliveryStatusUpdated: `${PH_BASE}/StructureDefinition/delivery-status-updated`,
  deliveryError: `${PH_BASE}/StructureDefinition/delivery-error`,
  // Header extension carrying the WhatsApp 24h service window.
  whatsappWindow: `${PH_BASE}/StructureDefinition/whatsapp-window`,
  // Child extension carrying RFC-5322 email headers for threading.
  emailHeaders: `${PH_BASE}/StructureDefinition/email-headers`,
  // Child extension marking message direction (loop-prevention defense-in-depth).
  origin: `${PH_BASE}/StructureDefinition/origin`,
  // Child extension carrying a chosen WhatsApp template (Content SID + variables).
  whatsappTemplate: `${PH_BASE}/StructureDefinition/whatsapp-template`,
  // Patient extension for a saved preferred channel (optional override).
  preferredChannel: `${PH_BASE}/StructureDefinition/preferred-channel`,
} as const;

export type Channel = 'whatsapp' | 'email';

export type DeliveryStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'undeliverable';

export type MessageOrigin = 'inbound' | 'outbound';

// WhatsApp free-form messaging is only allowed within 24h of the patient's last inbound message.
export const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

// The `triage` value used on a header `category` while the thread is unassigned.
export const TRIAGE_CATEGORY: CodeableConcept = {
  coding: [{ system: SYSTEM.threadStatus, code: 'triage', display: 'Unassigned' }],
};

// Build a `Communication.medium` CodeableConcept for the given channel.
export function channelToMedium(channel: Channel): CodeableConcept {
  if (channel === 'whatsapp') {
    return { coding: [{ system: SYSTEM.channel, code: 'whatsapp', display: 'WhatsApp' }] };
  }
  return { coding: [{ system: V3_PARTICIPATION_MODE, code: 'EMAILWRIT', display: 'email' }] };
}

// Read the channel back out of a `Communication.medium` array, if present.
export function mediumToChannel(medium: CodeableConcept[] | undefined): Channel | undefined {
  for (const concept of medium ?? []) {
    for (const coding of concept.coding ?? []) {
      if (coding.system === SYSTEM.channel && coding.code === 'whatsapp') {
        return 'whatsapp';
      }
      if (coding.system === V3_PARTICIPATION_MODE && coding.code === 'EMAILWRIT') {
        return 'email';
      }
    }
  }
  return undefined;
}
