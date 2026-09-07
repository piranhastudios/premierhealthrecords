// SPDX-FileCopyrightText: Copyright Premier Health Centres
// SPDX-License-Identifier: Apache-2.0

/**
 * Appointment notification bot.
 *
 * Subscription: `Appointment` (create + update). Sends the patient a confirmation
 * when an appointment becomes `booked`, a reschedule notice when a booked
 * appointment's time changes, and a cancellation notice when it is cancelled —
 * over WhatsApp or email via the outbound-dispatch bot (see lib/notify.ts).
 *
 * Idempotency / loop guard: the last notified `{start,end,status}` is stamped on the
 * Appointment (`appointment-notified` extension). The bot's own write-back
 * re-triggers the Subscription, but the state then matches and nothing is sent.
 * Each notice Communication also carries an idempotency identifier.
 *
 * Optional project secrets for WhatsApp business-initiated templates (outside the
 * 24h window Twilio requires an approved Content template):
 *   WHATSAPP_TEMPLATE_APPT_CONFIRMED_SID / _RESCHEDULED_SID / _CANCELLED_SID
 * Template variables: {1} patient name, {2} doctor, {3} date/time, {4} site.
 */

import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Appointment, Location, Patient, Practitioner, Reference } from '@medplum/fhirtypes';
import type { NoticeKind, NotifiedState } from './lib/appointments';
import {
  formatWhen,
  getNotifiedState,
  getParticipantRef,
  noticeText,
  notifiedStateExtension,
  resolveLocale,
} from './lib/appointments';
import { upsertExtension } from './lib/extensions';
import { queuePatientNotice } from './lib/notify';

function humanName(resource: { name?: { text?: string; given?: string[]; family?: string; prefix?: string[] }[] } | undefined): string {
  const name = resource?.name?.[0];
  if (!name) {
    return '';
  }
  return name.text ?? [name.prefix?.join(' '), name.given?.join(' '), name.family].filter(Boolean).join(' ');
}

/** Decide which notice (if any) the transition from `previous` to `current` warrants. */
export function decideNotice(previous: NotifiedState | undefined, current: NotifiedState): NoticeKind | undefined {
  if (current.status === 'cancelled') {
    // Only tell patients about cancellations of appointments they were told about.
    return previous && previous.status !== 'cancelled' ? 'cancelled' : undefined;
  }
  if (current.status !== 'booked') {
    return undefined;
  }
  if (!previous || previous.status !== 'booked') {
    return 'confirmed';
  }
  if (previous.start !== current.start || previous.end !== current.end) {
    return 'rescheduled';
  }
  return undefined;
}

export async function handler(medplum: MedplumClient, event: BotEvent<Appointment>): Promise<any> {
  const appointment = event.input;
  if (appointment?.resourceType !== 'Appointment' || !appointment.id) {
    return { skipped: 'not-an-appointment' };
  }

  const previous = getNotifiedState(appointment);
  const current: NotifiedState = { start: appointment.start, end: appointment.end, status: appointment.status };
  const kind = decideNotice(previous, current);
  if (!kind) {
    return { skipped: 'no-change' };
  }

  const patientRef = getParticipantRef(appointment, 'Patient') as Reference<Patient> | undefined;
  const practitionerRef = getParticipantRef(appointment, 'Practitioner') as Reference<Practitioner> | undefined;
  if (!patientRef) {
    return { skipped: 'no-patient' };
  }
  if (!practitionerRef) {
    // The dispatcher only delivers Practitioner-sent messages.
    return { skipped: 'no-practitioner' };
  }

  const [patient, practitioner, location] = await Promise.all([
    medplum.readReference(patientRef),
    medplum.readReference(practitionerRef).catch(() => undefined),
    (getParticipantRef(appointment, 'Location') as Reference<Location> | undefined)
      ? medplum.readReference(getParticipantRef(appointment, 'Location') as Reference<Location>).catch(() => undefined)
      : Promise.resolve(undefined),
  ]);

  const locale = resolveLocale(patient);
  const ctx = {
    patientName: humanName(patient) || (locale === 'fr' ? 'cher patient' : 'there'),
    doctorName: humanName(practitioner) || practitionerRef.display || '',
    siteName: location?.name ?? getParticipantRef(appointment, 'Location')?.display ?? '',
    when: formatWhen(appointment.start, locale),
    locale,
  };

  const templateSid = event.secrets[`WHATSAPP_TEMPLATE_APPT_${kind.toUpperCase()}_SID`]?.valueString;
  const result = await queuePatientNotice(medplum, {
    appointment,
    patient,
    sender: practitionerRef,
    kind,
    text: noticeText(kind, ctx),
    ...(templateSid
      ? { template: { sid: templateSid, vars: { 1: ctx.patientName, 2: ctx.doctorName, 3: ctx.when, 4: ctx.siteName } } }
      : {}),
  });

  // Stamp the notified state (even when the patient has no channel, so we don't
  // retry on every update; staff see the gap on the patient's contact details).
  const fresh = await medplum.readResource('Appointment', appointment.id);
  await medplum.updateResource({
    ...fresh,
    extension: upsertExtension(fresh.extension, notifiedStateExtension(current)),
  });

  return { kind, ...result, communication: result.communication?.id };
}
