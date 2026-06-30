// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Thin Resend client for outbound email, plus RFC-5322 threading-header helpers
 * shared with the outbound bot.
 */

import type { ProjectSetting } from '@medplum/fhirtypes';
import { randomUUID } from 'node:crypto';
import type { EmailHeaders } from './extensions';

export interface ResendConfig {
  apiKey: string;
  // Verified sender, e.g. `Premier Health <care@premierhealth.cm>`.
  from: string;
}

export function resendConfigFromSecrets(secrets: Record<string, ProjectSetting>): ResendConfig {
  const apiKey = secrets['RESEND_API_KEY']?.valueString;
  const from = secrets['RESEND_FROM_ADDRESS']?.valueString;
  if (!apiKey || !from) {
    throw new Error('Missing Resend secrets (RESEND_API_KEY, RESEND_FROM_ADDRESS)');
  }
  return { apiKey, from };
}

export interface SendEmailParams {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  // RFC-5322 headers (Message-ID, In-Reply-To, References).
  headers?: Record<string, string>;
}

export interface ResendResult {
  id: string;
}

// Send a transactional email via Resend.
export async function sendEmail(config: ResendConfig, params: SendEmailParams): Promise<ResendResult> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: config.from,
      to: params.to,
      subject: params.subject,
      ...(params.text ? { text: params.text } : {}),
      ...(params.html ? { html: params.html } : {}),
      ...(params.headers ? { headers: params.headers } : {}),
    }),
  });
  const json = (await response.json()) as any;
  if (!response.ok) {
    throw new Error(`Resend send failed (${response.status}): ${json?.message ?? response.statusText}`);
  }
  return { id: json.id };
}

// Generate an RFC-5322 Message-ID, using the sender's domain when derivable.
export function generateMessageId(fromAddress: string): string {
  const match = fromAddress.match(/@([^>\s]+)/);
  const domain = match ? match[1] : 'premierhealth.cm';
  return `<${randomUUID()}@${domain}>`;
}

// Build the outbound threading headers for a reply. Given the latest known email
// headers in the thread (if any), produce the new message's Message-ID plus the
// In-Reply-To / References chain.
export function buildReplyHeaders(
  newMessageId: string,
  previous: EmailHeaders | undefined
): { messageId: string; inReplyTo?: string; references?: string } {
  if (!previous) {
    return { messageId: newMessageId };
  }
  const chain = [previous.references, previous.inReplyTo, previous.messageId]
    .filter((s): s is string => !!s)
    .join(' ')
    .split(/\s+/)
    .filter(Boolean);
  // De-duplicate while preserving order.
  const references = [...new Set(chain)].join(' ');
  return { messageId: newMessageId, inReplyTo: previous.messageId, references };
}
