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

// Twilio's shared WhatsApp Sandbox sender.
export const TWILIO_SANDBOX_NUMBER = '+14155238886';

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  // The resolved WhatsApp sender (without the `whatsapp:` prefix).
  whatsappFrom: string;
  // True when running against the Twilio WhatsApp Sandbox (dev mode).
  sandbox: boolean;
}

// Read and validate the Twilio secrets from a bot event.
//
// Dev-mode flag: set the `TWILIO_SANDBOX` secret to `true` to use the Twilio WhatsApp
// Sandbox number (override via `TWILIO_SANDBOX_NUMBER`); otherwise the production
// sender `TWILIO_WHATSAPP_NUMBER` is used.
//
// Credentials: production always uses `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN`. In
// sandbox mode, the optional `TWILIO_TEST_ACCOUNT_SID` / `TWILIO_TEST_AUTH_TOKEN` pair
// is used if present, else it falls back to the live pair. NOTE: Twilio *test*
// credentials only reach the REST test API (magic numbers) and cannot send real
// WhatsApp or validate sandbox inbound signatures — for real sandbox WhatsApp testing
// leave `TWILIO_TEST_*` unset so the live credentials are used with the sandbox number.
export function twilioConfigFromSecrets(secrets: Record<string, ProjectSetting>): TwilioConfig {
  const sandbox = (secrets['TWILIO_SANDBOX']?.valueString ?? 'false').toLowerCase() === 'true';
  const liveSid = secrets['TWILIO_ACCOUNT_SID']?.valueString;
  const liveToken = secrets['TWILIO_AUTH_TOKEN']?.valueString;
  const accountSid = sandbox ? (secrets['TWILIO_TEST_ACCOUNT_SID']?.valueString ?? liveSid) : liveSid;
  const authToken = sandbox ? (secrets['TWILIO_TEST_AUTH_TOKEN']?.valueString ?? liveToken) : liveToken;
  const whatsappFrom = sandbox
    ? (secrets['TWILIO_SANDBOX_NUMBER']?.valueString ?? TWILIO_SANDBOX_NUMBER)
    : secrets['TWILIO_WHATSAPP_NUMBER']?.valueString;
  if (!accountSid || !authToken || !whatsappFrom) {
    throw new Error(
      sandbox
        ? 'Missing Twilio secrets (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN, or TWILIO_TEST_ACCOUNT_SID/TWILIO_TEST_AUTH_TOKEN)'
        : 'Missing Twilio secrets (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER) — or set TWILIO_SANDBOX=true'
    );
  }
  return { accountSid, authToken, whatsappFrom, sandbox };
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
  // getBaseUrl() includes a trailing slash; strip it so the URL matches exactly what
  // Twilio signs (a double slash would break signature validation).
  return `${medplum.getBaseUrl().replace(/\/$/, '')}/webhook/${resolveId(membership)}`;
}
