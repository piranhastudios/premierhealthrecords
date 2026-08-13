// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
// `Buffer` is imported explicitly rather than used as a global: bot code runs
// in a vmcontext sandbox that exposes `require` but NOT the Buffer global.
import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed unsubscribe links.
 *
 * Every marketing email carries a per-recipient link that revokes marketing
 * consent when clicked — no operator configuration, and no login required by
 * the patient. The patient id is HMAC-signed with a project secret so a link
 * cannot be forged or edited to unsubscribe somebody else.
 *
 * Secrets (set on the project by scripts/seed-subscriptions.mjs):
 *  - CAMPAIGN_UNSUBSCRIBE_URL    the public webhook URL of the unsubscribe bot
 *  - CAMPAIGN_UNSUBSCRIBE_SECRET the HMAC key
 */

/** Query parameter names on the unsubscribe link. */
export const UNSUBSCRIBE_PATIENT_PARAM = 'p';
export const UNSUBSCRIBE_TOKEN_PARAM = 't';

/**
 * Signs a patient id for an unsubscribe link.
 * @param patientId - The patient's id.
 * @param secret - The project's unsubscribe HMAC secret.
 * @returns A hex signature.
 */
export function signUnsubscribeToken(patientId: string, secret: string): string {
  return createHmac('sha256', secret).update(patientId).digest('hex');
}

/**
 * Constant-time verification of an unsubscribe token.
 * @param patientId - The patient id from the link.
 * @param token - The token from the link.
 * @param secret - The project's unsubscribe HMAC secret.
 * @returns True when the token is valid for that patient.
 */
export function verifyUnsubscribeToken(patientId: string, token: string, secret: string): boolean {
  if (!patientId || !token || !secret) {
    return false;
  }
  const expected = Buffer.from(signUnsubscribeToken(patientId, secret), 'utf8');
  const actual = Buffer.from(token, 'utf8');
  if (expected.length !== actual.length) {
    return false;
  }
  return timingSafeEqual(expected, actual);
}

/**
 * Builds the per-recipient unsubscribe URL, or undefined when the project has
 * no unsubscribe secrets configured (the footer link then renders empty rather
 * than pointing somewhere broken).
 *
 * @param patientId - The recipient's patient id.
 * @param baseUrl - CAMPAIGN_UNSUBSCRIBE_URL (the bot's public webhook URL).
 * @param secret - CAMPAIGN_UNSUBSCRIBE_SECRET.
 * @returns The signed unsubscribe URL, or undefined.
 */
export function buildUnsubscribeUrl(
  patientId: string,
  baseUrl: string | undefined,
  secret: string | undefined
): string | undefined {
  if (!baseUrl || !secret) {
    return undefined;
  }
  const url = new URL(baseUrl);
  url.searchParams.set(UNSUBSCRIBE_PATIENT_PARAM, patientId);
  url.searchParams.set(UNSUBSCRIBE_TOKEN_PARAM, signUnsubscribeToken(patientId, secret));
  return url.toString();
}
