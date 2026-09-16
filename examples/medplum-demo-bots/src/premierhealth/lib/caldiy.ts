// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Thin Cal.diy (Cal.com community edition) API v2 client plus the FHIR identifier
 * and extension systems the two sync bots share.
 *
 * Cal.diy is the public booking widget on the marketing website. Medplum stays the
 * system of record: every Cal.diy booking becomes a FHIR Appointment (webhook bot),
 * and every Medplum-side booking is mirrored into Cal.diy (mirror bot) so its
 * booking pages never offer a slot that is already taken.
 *
 * Project secrets:
 *   CALDIY_API_URL       e.g. http://caldiy-api:5555  (API v2 base, without /v2)
 *   CALDIY_API_KEY       cal_... API key of the Cal.diy admin user
 *   CALDIY_API_VERSION   optional, defaults to 2026-02-25 (cal-api-version header)
 *   CALDIY_WEBHOOK_SECRET  HMAC secret configured on the Cal.diy webhook
 */

import type { BotEvent } from '@medplum/core';
import type { ProjectSetting } from '@medplum/fhirtypes';
import { PH_BASE } from './constants';
import { verifyHmacSha256 } from './security';

export const CALDIY_IDENTIFIER = {
  // On Schedule: the Cal.diy event type id this (practitioner × site) diary maps to.
  eventType: `${PH_BASE}/sid/caldiy-event-type`,
  // On Schedule: `<username>/<event-slug>` for the website embed.
  calLink: `${PH_BASE}/sid/caldiy-cal-link`,
  // On Practitioner: Cal.diy user id.
  user: `${PH_BASE}/sid/caldiy-user`,
  // On Appointment: Cal.diy booking uid (origin = Cal.diy).
  booking: `${PH_BASE}/sid/caldiy-booking`,
  // On Appointment: uid of the mirror booking created in Cal.diy (origin = Medplum).
  mirror: `${PH_BASE}/sid/caldiy-mirror`,
} as const;

export const CALDIY_EXT = {
  // JSON `{start,end,status}` last pushed to Cal.diy by the mirror bot.
  mirrorState: `${PH_BASE}/StructureDefinition/caldiy-mirror-state`,
} as const;

export const DEFAULT_API_VERSION = '2026-02-25';
export const MIRROR_SOURCE = 'medplum';

export interface CaldiyConfig {
  apiUrl: string;
  apiKey: string;
  apiVersion: string;
}

export function caldiyConfigFromSecrets(secrets: Record<string, ProjectSetting>): CaldiyConfig | undefined {
  const apiUrl = secrets['CALDIY_API_URL']?.valueString?.replace(/\/+$/, '');
  const apiKey = secrets['CALDIY_API_KEY']?.valueString;
  if (!apiUrl || !apiKey) {
    return undefined;
  }
  return { apiUrl, apiKey, apiVersion: secrets['CALDIY_API_VERSION']?.valueString ?? DEFAULT_API_VERSION };
}

/** Cal.diy API v2 booking (subset of the 2024-08-13+ output shape). */
export interface CaldiyBooking {
  id?: number;
  uid: string;
  status?: string;
  start?: string;
  end?: string;
  duration?: number;
  eventTypeId?: number;
  eventType?: { id?: number; slug?: string };
  attendees?: CaldiyAttendee[];
  hosts?: { id?: number; name?: string; email?: string }[];
  bookingFieldsResponses?: Record<string, unknown>;
  metadata?: Record<string, string>;
  cancellationReason?: string;
  rescheduledFromUid?: string;
  description?: string;
}

export interface CaldiyAttendee {
  name?: string;
  email?: string;
  timeZone?: string;
  phoneNumber?: string;
  language?: string;
}

export interface CreateBookingInput {
  start: string;
  eventTypeId: number;
  lengthInMinutes?: number;
  attendee: CaldiyAttendee & { name: string; email: string; timeZone: string };
  metadata?: Record<string, string>;
  bookingFieldsResponses?: Record<string, unknown>;
}

async function api<T>(config: CaldiyConfig, method: string, path: string, body?: unknown): Promise<T | undefined> {
  const response = await fetch(`${config.apiUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'cal-api-version': config.apiVersion,
      'Content-Type': 'application/json',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 404) {
    return undefined;
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Cal.diy ${method} ${path} -> ${response.status} ${text.slice(0, 300)}`);
  }
  const json = text ? (JSON.parse(text) as { data?: T } | T) : undefined;
  // API v2 wraps results in `{ status, data }`.
  return json && typeof json === 'object' && 'data' in (json as object) ? (json as { data?: T }).data : (json as T);
}

export function getBooking(config: CaldiyConfig, uid: string): Promise<CaldiyBooking | undefined> {
  return api<CaldiyBooking>(config, 'GET', `/v2/bookings/${encodeURIComponent(uid)}`);
}

export async function createBooking(config: CaldiyConfig, input: CreateBookingInput): Promise<CaldiyBooking> {
  const booking = await api<CaldiyBooking>(config, 'POST', '/v2/bookings', input);
  if (!booking?.uid) {
    throw new Error('Cal.diy did not return a booking uid');
  }
  return booking;
}

export async function cancelBooking(config: CaldiyConfig, uid: string, reason: string): Promise<void> {
  await api(config, 'POST', `/v2/bookings/${encodeURIComponent(uid)}/cancel`, { cancellationReason: reason });
}

export async function rescheduleBooking(
  config: CaldiyConfig,
  uid: string,
  start: string,
  reason: string
): Promise<CaldiyBooking> {
  const booking = await api<CaldiyBooking>(config, 'POST', `/v2/bookings/${encodeURIComponent(uid)}/reschedule`, {
    start,
    reschedulingReason: reason,
  });
  if (!booking?.uid) {
    throw new Error('Cal.diy did not return a rescheduled booking uid');
  }
  return booking;
}

/**
 * Verify the `x-cal-signature-256` header (HMAC-SHA256 hex over the raw body).
 * Bots only see the parsed body, so the raw bytes are reconstructed with
 * `JSON.stringify` — Cal.com signs `JSON.stringify(body)` with the same key order
 * V8 preserves, so this normally matches. Callers must treat a mismatch as
 * "unknown", not "forged", and fall back to re-fetching the booking from the API.
 * @param event - The bot event carrying the webhook headers and body.
 * @param secret - The shared webhook secret; when unset nothing can be verified.
 * @returns True only when the signature matches.
 */
export function verifyCaldiySignature(event: BotEvent, secret: string | undefined): boolean {
  if (!secret || !event.headers) {
    return false;
  }
  const entry = Object.entries(event.headers).find(([key]) => key.toLowerCase() === 'x-cal-signature-256');
  const signature = Array.isArray(entry?.[1]) ? entry?.[1][0] : entry?.[1];
  if (!signature) {
    return false;
  }
  return verifyHmacSha256(JSON.stringify(event.input), signature, secret);
}

/**
 * Read the first identifier value for a system.
 * @param resource - Any resource carrying identifiers.
 * @param system - The identifier system to look for.
 * @returns The first matching value, or undefined when there is none.
 */
export function identifierValue(
  resource: { identifier?: { system?: string; value?: string }[] } | undefined,
  system: string
): string | undefined {
  return resource?.identifier?.find((i) => i.system === system)?.value;
}

/**
 * Cal.com booking-question responses come as `{ field: value }` or `{ field: { value } }`.
 * @param responses - The booking's answers, keyed by field name.
 * @param key - The field to read.
 * @returns The answer as text, or undefined when absent or not text-like.
 */
export function responseValue(responses: Record<string, unknown> | undefined, key: string): string | undefined {
  const raw = responses?.[key];
  if (typeof raw === 'object' && raw !== null && 'value' in raw) {
    return answerText((raw as { value?: unknown }).value);
  }
  return answerText(raw);
}

/**
 * Coerce one booking answer to text.
 *
 * Only primitives and arrays of them are answers we can use: passing an object
 * to `String` yields "[object Object]", which would otherwise be written into a
 * patient record as if it were their answer.
 * @param value - The raw answer.
 * @returns The answer as text, or undefined when it is not text-like.
 */
function answerText(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    // Multi-select answers arrive as arrays.
    const parts = value.map(answerText).filter((part): part is string => part !== undefined);
    return parts.length > 0 ? parts.join(', ') : undefined;
  }
  return undefined;
}
