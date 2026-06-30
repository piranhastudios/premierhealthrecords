// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Read/write helpers for the Premier Health messaging extensions and identifiers.
 * All builders return plain FHIR fragments so callers can compose them into a
 * `createResource` / `updateResource` payload.
 */

import type { Communication, Extension, Identifier, Resource } from '@medplum/fhirtypes';
import type { DeliveryStatus, MessageOrigin } from './constants';
import { EXT, WHATSAPP_WINDOW_MS } from './constants';

// Replace (by `url`) or append a top-level extension, returning a new array.
export function upsertExtension(extensions: Extension[] | undefined, next: Extension): Extension[] {
  const rest = (extensions ?? []).filter((e) => e.url !== next.url);
  return [...rest, next];
}

// Append an identifier if one with the same system is not already present.
export function upsertIdentifier(identifiers: Identifier[] | undefined, next: Identifier): Identifier[] {
  const rest = (identifiers ?? []).filter((i) => i.system !== next.system);
  return [...rest, next];
}

// First identifier value for a system, if any.
export function getIdentifierValue(
  resource: Resource & { identifier?: Identifier[] },
  system: string
): string | undefined {
  return resource.identifier?.find((i) => i.system === system)?.value;
}

// --- Origin (loop-prevention marker) -------------------------------------------------

export function originExtension(origin: MessageOrigin): Extension {
  return { url: EXT.origin, valueCode: origin };
}

export function getOrigin(comm: Communication): MessageOrigin | undefined {
  return comm.extension?.find((e) => e.url === EXT.origin)?.valueCode as MessageOrigin | undefined;
}

// --- WhatsApp 24h service window (on the thread header) -------------------------------

// Build the window extension from a "last inbound" instant.
export function whatsappWindowExtension(lastInboundAt: string): Extension {
  const expiresAt = new Date(new Date(lastInboundAt).getTime() + WHATSAPP_WINDOW_MS).toISOString();
  return {
    url: EXT.whatsappWindow,
    extension: [
      { url: 'lastInboundAt', valueInstant: lastInboundAt },
      { url: 'expiresAt', valueInstant: expiresAt },
    ],
  };
}

// Read the window expiry instant from a header, if set.
export function getWhatsappWindowExpiresAt(header: Communication): string | undefined {
  const window = header.extension?.find((e) => e.url === EXT.whatsappWindow);
  return window?.extension?.find((e) => e.url === 'expiresAt')?.valueInstant;
}

// Whether the WhatsApp free-form window is currently open for this header.
export function isWhatsappWindowOpen(header: Communication, now: Date): boolean {
  const expiresAt = getWhatsappWindowExpiresAt(header);
  return !!expiresAt && new Date(expiresAt).getTime() > now.getTime();
}

// --- Email headers (RFC-5322 threading) ----------------------------------------------

export interface EmailHeaders {
  messageId: string;
  inReplyTo?: string;
  references?: string;
  subject?: string;
}

export function emailHeadersExtension(headers: EmailHeaders): Extension {
  const nested: Extension[] = [{ url: 'messageId', valueString: headers.messageId }];
  if (headers.inReplyTo) {
    nested.push({ url: 'inReplyTo', valueString: headers.inReplyTo });
  }
  if (headers.references) {
    nested.push({ url: 'references', valueString: headers.references });
  }
  if (headers.subject) {
    nested.push({ url: 'subject', valueString: headers.subject });
  }
  return { url: EXT.emailHeaders, extension: nested };
}

export function getEmailHeaders(comm: Communication): EmailHeaders | undefined {
  const ext = comm.extension?.find((e) => e.url === EXT.emailHeaders);
  if (!ext?.extension) {
    return undefined;
  }
  const get = (url: string): string | undefined => ext.extension?.find((e) => e.url === url)?.valueString;
  const messageId = get('messageId');
  if (!messageId) {
    return undefined;
  }
  return { messageId, inReplyTo: get('inReplyTo'), references: get('references'), subject: get('subject') };
}

// --- WhatsApp template intent (on an outbound child) ---------------------------------

export interface WhatsappTemplate {
  sid: string;
  vars: Record<string, string>;
}

export function whatsappTemplateExtension(template: WhatsappTemplate): Extension {
  return {
    url: EXT.whatsappTemplate,
    extension: [
      { url: 'sid', valueString: template.sid },
      { url: 'vars', valueString: JSON.stringify(template.vars) },
    ],
  };
}

export function getWhatsappTemplate(comm: Communication): WhatsappTemplate | undefined {
  const ext = comm.extension?.find((e) => e.url === EXT.whatsappTemplate);
  const sid = ext?.extension?.find((e) => e.url === 'sid')?.valueString;
  if (!sid) {
    return undefined;
  }
  const varsRaw = ext?.extension?.find((e) => e.url === 'vars')?.valueString;
  let vars: Record<string, string> = {};
  if (varsRaw) {
    try {
      vars = JSON.parse(varsRaw) as Record<string, string>;
    } catch {
      vars = {};
    }
  }
  return { sid, vars };
}

// --- Delivery status (on an outbound child) ------------------------------------------

// Returns a new extension array with delivery status/timestamp/error upserted.
export function setDeliveryStatus(
  extensions: Extension[] | undefined,
  status: DeliveryStatus,
  updatedAt: string,
  error?: string
): Extension[] {
  let next = upsertExtension(extensions, { url: EXT.deliveryStatus, valueCode: status });
  next = upsertExtension(next, { url: EXT.deliveryStatusUpdated, valueInstant: updatedAt });
  if (error) {
    next = upsertExtension(next, { url: EXT.deliveryError, valueString: error });
  } else {
    next = next.filter((e) => e.url !== EXT.deliveryError);
  }
  return next;
}

export function getDeliveryStatus(comm: Communication): DeliveryStatus | undefined {
  return comm.extension?.find((e) => e.url === EXT.deliveryStatus)?.valueCode as DeliveryStatus | undefined;
}
