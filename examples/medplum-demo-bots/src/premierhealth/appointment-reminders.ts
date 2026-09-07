// SPDX-FileCopyrightText: Copyright Premier Health Centres
// SPDX-License-Identifier: Apache-2.0

/**
 * Appointment reminder bot (cron, hourly — see scripts/seed-subscriptions.mjs).
 *
 * Finds booked appointments starting 23–25 hours from now and queues a reminder
 * for the patient (WhatsApp or email via the outbound-dispatch bot). Each
 * Appointment is stamped with `appointment-reminder-sent` so the next tick skips it.
 *
 * Optional project secret WHATSAPP_TEMPLATE_APPT_REMINDER_SID (Twilio Content
 * template) for WhatsApp outside the 24h service window.
 */

import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Location, Patient, Practitioner, Reference } from '@medplum/fhirtypes';
import {
  formatWhen,
  getParticipantRef,
  isReminderSent,
  noticeText,
  reminderSentExtension,
  resolveLocale,
} from './lib/appointments';
import { upsertExtension } from './lib/extensions';
import { queuePatientNotice } from './lib/notify';

const HOUR_MS = 60 * 60 * 1000;
// Window: appointments starting between 23h and 25h from now (hourly cron).
const WINDOW_START_HOURS = 23;
const WINDOW_END_HOURS = 25;

function humanName(resource: { name?: { text?: string; given?: string[]; family?: string; prefix?: string[] }[] } | undefined): string {
  const name = resource?.name?.[0];
  if (!name) {
    return '';
  }
  return name.text ?? [name.prefix?.join(' '), name.given?.join(' '), name.family].filter(Boolean).join(' ');
}

export async function handler(medplum: MedplumClient, event: BotEvent): Promise<any> {
  const now = Date.now();
  const windowStart = new Date(now + WINDOW_START_HOURS * HOUR_MS).toISOString();
  const windowEnd = new Date(now + WINDOW_END_HOURS * HOUR_MS).toISOString();

  const appointments = await medplum.searchResources(
    'Appointment',
    `status=booked&date=ge${windowStart}&date=le${windowEnd}&_count=200`
  );

  const templateSid = event.secrets['WHATSAPP_TEMPLATE_APPT_REMINDER_SID']?.valueString;
  let queued = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const appointment of appointments) {
    if (!appointment.id || isReminderSent(appointment)) {
      skipped++;
      continue;
    }
    const patientRef = getParticipantRef(appointment, 'Patient') as Reference<Patient> | undefined;
    const practitionerRef = getParticipantRef(appointment, 'Practitioner') as Reference<Practitioner> | undefined;
    if (!patientRef || !practitionerRef) {
      skipped++;
      continue;
    }
    try {
      const locationRef = getParticipantRef(appointment, 'Location') as Reference<Location> | undefined;
      const [patient, practitioner, location] = await Promise.all([
        medplum.readReference(patientRef),
        medplum.readReference(practitionerRef).catch(() => undefined),
        locationRef ? medplum.readReference(locationRef).catch(() => undefined) : Promise.resolve(undefined),
      ]);
      const locale = resolveLocale(patient);
      const ctx = {
        patientName: humanName(patient) || (locale === 'fr' ? 'cher patient' : 'there'),
        doctorName: humanName(practitioner) || practitionerRef.display || '',
        siteName: location?.name ?? locationRef?.display ?? '',
        when: formatWhen(appointment.start, locale),
        locale,
      };
      await queuePatientNotice(medplum, {
        appointment,
        patient,
        sender: practitionerRef,
        kind: 'reminder',
        text: noticeText('reminder', ctx),
        ...(templateSid
          ? {
              template: {
                sid: templateSid,
                vars: { 1: ctx.patientName, 2: ctx.doctorName, 3: ctx.when, 4: ctx.siteName },
              },
            }
          : {}),
      });
      const fresh = await medplum.readResource('Appointment', appointment.id);
      await medplum.updateResource({
        ...fresh,
        extension: upsertExtension(fresh.extension, reminderSentExtension()),
      });
      queued++;
    } catch (err) {
      errors.push(`${appointment.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { window: { start: windowStart, end: windowEnd }, found: appointments.length, queued, skipped, errors };
}
