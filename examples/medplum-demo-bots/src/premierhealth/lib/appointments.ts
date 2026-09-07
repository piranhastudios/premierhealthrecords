// SPDX-FileCopyrightText: Copyright Premier Health Centres
// SPDX-License-Identifier: Apache-2.0

/**
 * Shared helpers for the appointment notification bots (confirmation, reschedule,
 * cancellation, reminder) and the Cal.diy sync bots: participant lookup, clinic
 * time formatting, patient locale, and the small state extensions that make the
 * bots idempotent.
 */

import type { Appointment, Extension, Patient, Reference } from '@medplum/fhirtypes';
import { PH_BASE } from './constants';

export const CLINIC_TIMEZONE = 'Africa/Douala';

export const APPOINTMENT_EXT = {
  // JSON `{start,end,status}` of the last state a notice was sent for.
  notified: `${PH_BASE}/StructureDefinition/appointment-notified`,
  // Set once the 24h reminder has been queued.
  reminderSent: `${PH_BASE}/StructureDefinition/appointment-reminder-sent`,
} as const;

export const APPOINTMENT_IDENTIFIER = {
  // Idempotency key on each notice Communication: `<appointmentId>:<kind>:<start>`.
  notice: `${PH_BASE}/sid/appointment-notice`,
} as const;

export type Locale = 'en' | 'fr';
export type NoticeKind = 'confirmed' | 'rescheduled' | 'cancelled' | 'reminder';

export interface NotifiedState {
  start?: string;
  end?: string;
  status?: string;
}

/** First participant actor of the given resource type. */
export function getParticipantRef(appointment: Appointment, resourceType: string): Reference | undefined {
  return appointment.participant?.find((p) => p.actor?.reference?.startsWith(`${resourceType}/`))?.actor;
}

/** Patient locale from `Patient.communication` (French when any language starts with `fr`). */
export function resolveLocale(patient: Patient | undefined): Locale {
  for (const communication of patient?.communication ?? []) {
    const codes = [
      ...(communication.language?.coding ?? []).map((c) => c.code ?? ''),
      communication.language?.text ?? '',
    ];
    if (codes.some((code) => code.toLowerCase().startsWith('fr'))) {
      return 'fr';
    }
  }
  return 'en';
}

/** Human date/time in the clinic timezone, e.g. "Monday 8 September at 10:30". */
export function formatWhen(iso: string | undefined, locale: Locale, timeZone = CLINIC_TIMEZONE): string {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  const formatter = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return formatter.format(date);
}

export function getNotifiedState(appointment: Appointment): NotifiedState | undefined {
  const raw = appointment.extension?.find((e) => e.url === APPOINTMENT_EXT.notified)?.valueString;
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as NotifiedState;
  } catch {
    return undefined;
  }
}

export function notifiedStateExtension(state: NotifiedState): Extension {
  return { url: APPOINTMENT_EXT.notified, valueString: JSON.stringify(state) };
}

export function isReminderSent(appointment: Appointment): boolean {
  return appointment.extension?.some((e) => e.url === APPOINTMENT_EXT.reminderSent && e.valueBoolean) ?? false;
}

export function reminderSentExtension(): Extension {
  return { url: APPOINTMENT_EXT.reminderSent, valueBoolean: true };
}

export interface NoticeContext {
  patientName: string;
  doctorName: string;
  siteName: string;
  when: string;
  locale: Locale;
}

/** Message copy per notice kind and locale. Plain text: works for WhatsApp and email. */
export function noticeText(kind: NoticeKind, ctx: NoticeContext): string {
  const at = ctx.siteName ? (ctx.locale === 'fr' ? ` à ${ctx.siteName}` : ` at ${ctx.siteName}`) : '';
  const withDoctor = ctx.doctorName
    ? ctx.locale === 'fr'
      ? ` avec ${ctx.doctorName}`
      : ` with ${ctx.doctorName}`
    : '';
  const greet = ctx.locale === 'fr' ? `Bonjour ${ctx.patientName},` : `Hello ${ctx.patientName},`;
  const sign = ctx.locale === 'fr' ? '– Premier Health Centres' : '– Premier Health Centres';

  if (ctx.locale === 'fr') {
    switch (kind) {
      case 'confirmed':
        return `${greet} votre rendez-vous${withDoctor}${at} est confirmé pour le ${ctx.when}. Répondez à ce message si vous devez le modifier. ${sign}`;
      case 'rescheduled':
        return `${greet} votre rendez-vous${withDoctor}${at} a été déplacé au ${ctx.when}. Répondez à ce message si cela ne vous convient pas. ${sign}`;
      case 'cancelled':
        return `${greet} votre rendez-vous${withDoctor}${at} prévu le ${ctx.when} a été annulé. Répondez à ce message pour choisir un nouveau créneau. ${sign}`;
      case 'reminder':
        return `${greet} rappel : votre rendez-vous${withDoctor}${at} est prévu demain, ${ctx.when}. Répondez à ce message si vous ne pouvez pas venir. ${sign}`;
      default:
        return '';
    }
  }
  switch (kind) {
    case 'confirmed':
      return `${greet} your appointment${withDoctor}${at} is confirmed for ${ctx.when}. Reply to this message if you need to change it. ${sign}`;
    case 'rescheduled':
      return `${greet} your appointment${withDoctor}${at} has been moved to ${ctx.when}. Reply to this message if that does not suit you. ${sign}`;
    case 'cancelled':
      return `${greet} your appointment${withDoctor}${at} on ${ctx.when} has been cancelled. Reply to this message to book a new time. ${sign}`;
    case 'reminder':
      return `${greet} reminder: your appointment${withDoctor}${at} is tomorrow, ${ctx.when}. Reply to this message if you cannot make it. ${sign}`;
    default:
      return '';
  }
}
