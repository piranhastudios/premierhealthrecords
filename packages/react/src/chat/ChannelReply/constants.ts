// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * UI-side mirror of the Premier Health messaging channel model (see the bot library
 * at examples/medplum-demo-bots/src/premierhealth/lib/constants.ts). Kept minimal:
 * only what the channel-aware reply box, 24h-window banner, and template picker need.
 */

import type { Basic, CodeableConcept, Communication, Extension } from '@medplum/fhirtypes';

export const PH_FHIR = 'https://premierhealth.cm/fhir';
export const CHANNEL_SYSTEM = `${PH_FHIR}/CodeSystem/communication-channel`;
export const V3_PARTICIPATION_MODE = 'http://terminology.hl7.org/CodeSystem/v3-ParticipationMode';
export const EXT_WHATSAPP_WINDOW = `${PH_FHIR}/StructureDefinition/whatsapp-window`;
export const EXT_WHATSAPP_TEMPLATE = `${PH_FHIR}/StructureDefinition/whatsapp-template`;
export const TEMPLATE_TYPE_SYSTEM = `${PH_FHIR}/CodeSystem/template-type`;
export const TWILIO_CONTENT_SYSTEM = `${PH_FHIR}/sid/twilio-content`;
export const EXT_TEMPLATE_NAME = `${PH_FHIR}/StructureDefinition/template-name`;
export const EXT_TEMPLATE_LANGUAGE = `${PH_FHIR}/StructureDefinition/template-language`;
export const EXT_TEMPLATE_BODY_PREVIEW = `${PH_FHIR}/StructureDefinition/template-body-preview`;
export const EXT_TEMPLATE_VARIABLE = `${PH_FHIR}/StructureDefinition/template-variable`;

export type MessagingChannel = 'whatsapp' | 'email';

// Build a `Communication.medium` for a channel.
export function channelToMedium(channel: MessagingChannel): CodeableConcept {
  if (channel === 'whatsapp') {
    return { coding: [{ system: CHANNEL_SYSTEM, code: 'whatsapp', display: 'WhatsApp' }] };
  }
  return { coding: [{ system: V3_PARTICIPATION_MODE, code: 'EMAILWRIT', display: 'email' }] };
}

// Read the channel from a thread/message `medium`, if present.
export function getThreadChannel(communication: Communication | undefined): MessagingChannel | undefined {
  for (const concept of communication?.medium ?? []) {
    for (const coding of concept.coding ?? []) {
      if (coding.system === CHANNEL_SYSTEM && coding.code === 'whatsapp') {
        return 'whatsapp';
      }
      if (coding.system === V3_PARTICIPATION_MODE && coding.code === 'EMAILWRIT') {
        return 'email';
      }
    }
  }
  return undefined;
}

// Read the WhatsApp 24h window expiry instant from a thread header.
export function getWhatsappWindowExpiresAt(header: Communication | undefined): string | undefined {
  const window = header?.extension?.find((e) => e.url === EXT_WHATSAPP_WINDOW);
  return window?.extension?.find((e) => e.url === 'expiresAt')?.valueInstant;
}

// Whether the WhatsApp free-form window is currently open.
export function isWhatsappWindowOpen(header: Communication | undefined, now: Date = new Date()): boolean {
  const expiresAt = getWhatsappWindowExpiresAt(header);
  return !!expiresAt && new Date(expiresAt).getTime() > now.getTime();
}

// Derive a display-ready window state (open + whole hours remaining) from an expiry instant.
export function getWhatsappWindowState(expiresAt: string | undefined): { open: boolean; hoursLeft: number } {
  const expiry = expiresAt ? new Date(expiresAt).getTime() : 0;
  const remaining = expiry - Date.now();
  const open = remaining > 0;
  return { open, hoursLeft: open ? Math.max(1, Math.round(remaining / 3_600_000)) : 0 };
}

export interface SelectedTemplate {
  // Twilio Content API content SID.
  sid: string;
  // Ordered template variables keyed `"1"`, `"2"`, ...
  vars: Record<string, string>;
  // Rendered preview text shown in the chat bubble.
  preview: string;
}

// Build the `whatsapp-template` extension stamped on an outbound template message.
export function whatsappTemplateExtension(template: { sid: string; vars: Record<string, string> }): Extension {
  return {
    url: EXT_WHATSAPP_TEMPLATE,
    extension: [
      { url: 'sid', valueString: template.sid },
      { url: 'vars', valueString: JSON.stringify(template.vars) },
    ],
  };
}

export interface WhatsAppTemplateVariable {
  // Twilio variable index, `"1"`, `"2"`, ...
  index: string;
  label: string;
}

export interface WhatsAppTemplate {
  id: string;
  contentSid: string;
  name: string;
  language?: string;
  bodyPreview: string;
  variables: WhatsAppTemplateVariable[];
}

// Parse a `Basic` catalog resource into a WhatsApp template, or undefined if invalid.
export function parseWhatsAppTemplate(basic: Basic): WhatsAppTemplate | undefined {
  const contentSid = basic.identifier?.find((i) => i.system === TWILIO_CONTENT_SYSTEM)?.value;
  if (!contentSid) {
    return undefined;
  }
  const get = (url: string): string | undefined => basic.extension?.find((e) => e.url === url)?.valueString;
  const variables = (basic.extension ?? [])
    .filter((e) => e.url === EXT_TEMPLATE_VARIABLE)
    .map((e, idx) => ({ index: String(idx + 1), label: e.valueString ?? `Variable ${idx + 1}` }));
  return {
    id: basic.id as string,
    contentSid,
    name: get(EXT_TEMPLATE_NAME) ?? 'Untitled template',
    language: get(EXT_TEMPLATE_LANGUAGE),
    bodyPreview: get(EXT_TEMPLATE_BODY_PREVIEW) ?? '',
    variables,
  };
}

// Substitute `{{1}}`, `{{2}}`, ... placeholders in a template body with values.
export function renderTemplatePreview(bodyPreview: string, vars: Record<string, string>): string {
  return bodyPreview.replace(/\{\{\s*(\d+)\s*\}\}/g, (_match, index: string) => vars[index] || `{{${index}}}`);
}
