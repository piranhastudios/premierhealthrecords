// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Thin Twilio Programmable Messaging client for WhatsApp, plus the shared helper
 * for computing a bot's public webhook URL (needed for Twilio signature validation).
 */

import { getReferenceString, resolveId } from '@medplum/core';
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { ProjectSetting } from '@medplum/fhirtypes';
import { toWhatsappAddress } from './phone';

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  // The WhatsApp sender, e.g. `+14155238886` (without the `whatsapp:` prefix).
  whatsappFrom: string;
}

// Read and validate the Twilio secrets from a bot event.
export function twilioConfigFromSecrets(secrets: Record<string, ProjectSetting>): TwilioConfig {
  const accountSid = secrets['TWILIO_ACCOUNT_SID']?.valueString;
  const authToken = secrets['TWILIO_AUTH_TOKEN']?.valueString;
  const whatsappFrom = secrets['TWILIO_WHATSAPP_NUMBER']?.valueString;
  if (!accountSid || !authToken || !whatsappFrom) {
    throw new Error('Missing Twilio secrets (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER)');
  }
  return { accountSid, authToken, whatsappFrom };
}

function basicAuth(config: TwilioConfig): string {
  return `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}`;
}

export interface SendWhatsappParams {
  // Patient E.164 number (without `whatsapp:` prefix).
  to: string;
  // Free-form body (only valid inside the 24h window).
  body?: string;
  // Twilio Content API content SID (required outside the window).
  contentSid?: string;
  // Ordered template variables, keyed `"1"`, `"2"`, ...
  contentVariables?: Record<string, string>;
  // Optional delivery status callback URL.
  statusCallback?: string;
}

export interface TwilioMessageResult {
  sid: string;
  status?: string;
  errorMessage?: string;
}

// Send a WhatsApp message (free-form or template) via Twilio.
export async function sendWhatsApp(config: TwilioConfig, params: SendWhatsappParams): Promise<TwilioMessageResult> {
  const form = new URLSearchParams();
  form.set('From', toWhatsappAddress(config.whatsappFrom));
  form.set('To', toWhatsappAddress(params.to));
  if (params.contentSid) {
    form.set('ContentSid', params.contentSid);
    if (params.contentVariables && Object.keys(params.contentVariables).length > 0) {
      form.set('ContentVariables', JSON.stringify(params.contentVariables));
    }
  } else if (params.body) {
    form.set('Body', params.body);
  } else {
    throw new Error('sendWhatsApp requires either body or contentSid');
  }
  if (params.statusCallback) {
    form.set('StatusCallback', params.statusCallback);
  }

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: basicAuth(config), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });

  const json = (await response.json()) as any;
  if (!response.ok) {
    throw new Error(`Twilio send failed (${response.status}): ${json?.message ?? response.statusText}`);
  }
  return { sid: json.sid, status: json.status, errorMessage: json.error_message ?? undefined };
}

// Download a Twilio-hosted media attachment (authenticated).
export async function downloadTwilioMedia(
  config: TwilioConfig,
  url: string
): Promise<{ contentType: string; data: ArrayBuffer }> {
  const response = await fetch(url, { headers: { Authorization: basicAuth(config) } });
  if (!response.ok) {
    throw new Error(`Failed to download Twilio media (${response.status})`);
  }
  return {
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    data: await response.arrayBuffer(),
  };
}

// Compute this bot's public webhook URL, used to validate Twilio signatures.
export async function getBotWebhookUrl(medplum: MedplumClient, event: BotEvent<any>): Promise<string> {
  const membership = await medplum.searchOne('ProjectMembership', { profile: getReferenceString(event.bot) });
  if (!membership) {
    throw new Error('Could not find the bot membership');
  }
  return `${medplum.getBaseUrl()}/webhook/${resolveId(membership)}`;
}
