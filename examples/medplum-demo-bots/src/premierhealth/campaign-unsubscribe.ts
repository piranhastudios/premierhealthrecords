// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Campaign unsubscribe bot.
 *
 * Public webhook (`Bot.publicWebhook = true`) targeted by the signed link in
 * every marketing email's footer, and by the RFC-8058 `List-Unsubscribe-Post`
 * header that mail clients call for their one-click Unsubscribe button.
 *
 * GET  — a patient clicking the footer link; responds with an HTML confirmation.
 * POST — a mail client's one-click unsubscribe; responds with plain text.
 *
 * The patient id is HMAC-signed (CAMPAIGN_UNSUBSCRIBE_SECRET) so a link cannot
 * be forged or edited to unsubscribe a different patient. Unsubscribing writes
 * a deny marketing Consent, tags the patient `email-suppressed`, and cancels
 * their in-flight campaign enrolments — the same suppression path as a bounce.
 */

import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Binary, Patient, Task } from '@medplum/fhirtypes';
// The vmcontext bot sandbox exposes `require` but not the Buffer global.
import { Buffer } from 'node:buffer';
import {
  CONSENT_SCOPE_MARKETING,
  TASK_CAMPAIGN_ENROLMENT,
  TASK_TYPE_SYSTEM,
  revokeConsent,
  suppressPatient,
} from '@medplum/campaigns';
import {
  UNSUBSCRIBE_PATIENT_PARAM,
  UNSUBSCRIBE_TOKEN_PARAM,
  verifyUnsubscribeToken,
} from '@medplum/campaigns/node';

interface UnsubscribeInput {
  [key: string]: string | undefined;
}

function htmlPage(title: string, message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="margin:0;font-family:Helvetica,Arial,sans-serif;background:#f5f2ee;display:flex;min-height:100vh;align-items:center;justify-content:center"><div style="background:#fff;border-radius:12px;padding:40px;max-width:460px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.08)"><h1 style="margin:0 0 12px;font-size:20px;color:#1a1a1a">${title}</h1><p style="margin:0;font-size:15px;line-height:1.6;color:#555">${message}</p></div></body></html>`;
}

function htmlResponse(title: string, message: string): Binary {
  return {
    resourceType: 'Binary',
    contentType: 'text/html',
    data: Buffer.from(htmlPage(title, message), 'utf8').toString('base64'),
  };
}

export async function handler(medplum: MedplumClient, event: BotEvent<UnsubscribeInput>): Promise<any> {
  const input = (event.input ?? {});
  const patientId = input[UNSUBSCRIBE_PATIENT_PARAM];
  const token = input[UNSUBSCRIBE_TOKEN_PARAM];
  const secret = event.secrets['CAMPAIGN_UNSUBSCRIBE_SECRET']?.valueString;

  if (!secret) {
    console.error('CAMPAIGN_UNSUBSCRIBE_SECRET is not configured');
    return htmlResponse('Something went wrong', 'We could not process this request. Please contact the clinic.');
  }
  if (!patientId || !token || !verifyUnsubscribeToken(patientId, token, secret)) {
    // Same response either way — never reveal whether the patient exists.
    return htmlResponse('Link not valid', 'This unsubscribe link is invalid or has expired.');
  }

  const patientRef = `Patient/${patientId}`;
  let patient: Patient & { id: string };
  try {
    patient = await medplum.readResource('Patient', patientId);
  } catch {
    return htmlResponse('Link not valid', 'This unsubscribe link is invalid or has expired.');
  }

  await revokeConsent(medplum, patientRef, CONSENT_SCOPE_MARKETING, 'Patient unsubscribed from marketing email');
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
      statusReason: { text: 'Patient unsubscribed' },
    });
  }

  // One-click unsubscribe (RFC 8058) POSTs and expects a simple 200.
  if (event.contentType?.includes('form') || event.contentType?.includes('json')) {
    return { unsubscribed: true, cancelledEnrolments: enrolments.length };
  }

  return htmlResponse(
    'You have been unsubscribed',
    'You will no longer receive marketing emails from us. Appointment reminders and other messages about your care are not affected.'
  );
}
