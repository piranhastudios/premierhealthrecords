// SPDX-FileCopyrightText: Copyright Premier Health Centres
// SPDX-License-Identifier: Apache-2.0

/**
 * Medplum → Cal.diy mirror bot.
 *
 * Subscription: `Appointment` (create + update), with a FHIRPath criteria that
 * excludes appointments carrying the `caldiy-booking` identifier (they came FROM
 * Cal.diy). For every other appointment on a Schedule that maps to a Cal.diy event
 * type, a mirror booking is created / rescheduled / cancelled in Cal.diy through
 * API v2 so the public booking pages never offer a slot the portal or the provider
 * app already booked.
 *
 * Loop guards:
 *  - mirror bookings carry `metadata.source = medplum` (the webhook bot skips them)
 *    and their uid is stored on the Appointment as `caldiy-mirror`;
 *  - the last pushed `{start,end,status}` is stamped in the `caldiy-mirror-state`
 *    extension, so the bot's own write-back is a no-op.
 *
 * Cal.diy sends no email (no SMTP configured), so the placeholder attendee email
 * used when a patient has none never reaches anyone.
 */

import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Appointment, Extension, Patient, Reference, Schedule, Slot } from '@medplum/fhirtypes';
import { CLINIC_TIMEZONE, getParticipantRef } from './lib/appointments';
import {
  CALDIY_EXT,
  CALDIY_IDENTIFIER,
  MIRROR_SOURCE,
  caldiyConfigFromSecrets,
  cancelBooking,
  createBooking,
  identifierValue,
  rescheduleBooking,
} from './lib/caldiy';
import { upsertExtension, upsertIdentifier } from './lib/extensions';

const SERVICE_TYPE_REFERENCE_URL = 'https://medplum.com/fhir/service-type-reference';
const PLACEHOLDER_EMAIL_DOMAIN = 'noreply.premierhealthcentrescameroon.com';

// Statuses that keep the slot occupied in Cal.diy.
const OCCUPYING = new Set(['booked', 'arrived', 'checked-in', 'fulfilled']);
// Statuses that release it.
const RELEASING = new Set(['cancelled', 'noshow', 'entered-in-error']);

export interface MirrorState {
  start?: string;
  end?: string;
  status: 'booked' | 'cancelled';
}

export function getMirrorState(appointment: Appointment): MirrorState | undefined {
  const raw = appointment.extension?.find((e) => e.url === CALDIY_EXT.mirrorState)?.valueString;
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as MirrorState;
  } catch {
    return undefined;
  }
}

function mirrorStateExtension(state: MirrorState): Extension {
  return { url: CALDIY_EXT.mirrorState, valueString: JSON.stringify(state) };
}

function humanName(patient: Patient): string {
  const name = patient.name?.[0];
  const text = name?.text ?? [name?.given?.join(' '), name?.family].filter(Boolean).join(' ');
  return text || 'Patient';
}

async function resolveSchedule(medplum: MedplumClient, appointment: Appointment): Promise<Schedule | undefined> {
  const slotRef = appointment.slot?.[0];
  if (slotRef?.reference) {
    const slot = await medplum.readReference(slotRef as Reference<Slot>).catch(() => undefined);
    if (slot?.schedule?.reference) {
      const schedule = await medplum.readReference(slot.schedule as Reference<Schedule>).catch(() => undefined);
      if (schedule) {
        return schedule;
      }
    }
  }
  const practitioner = getParticipantRef(appointment, 'Practitioner')?.reference;
  if (!practitioner) {
    return undefined;
  }
  const location = getParticipantRef(appointment, 'Location')?.reference;
  const candidates = await medplum.searchResources(
    'Schedule',
    `actor=${practitioner}${location ? `&actor=${location}` : ''}&active=true&_count=20`
  );
  return (
    candidates.find((s) => identifierValue(s, CALDIY_IDENTIFIER.eventType) && (!location || s.actor.some((a) => a.reference === location))) ??
    candidates.find((s) => identifierValue(s, CALDIY_IDENTIFIER.eventType))
  );
}

function serviceIdOf(appointment: Appointment): string | undefined {
  const ref = appointment.serviceType
    ?.map((concept) => concept.extension?.find((e) => e.url === SERVICE_TYPE_REFERENCE_URL)?.valueReference?.reference)
    .find(Boolean);
  return ref?.split('/')[1];
}

async function stamp(
  medplum: MedplumClient,
  appointmentId: string,
  state: MirrorState,
  mirrorUid?: string
): Promise<void> {
  const fresh = await medplum.readResource('Appointment', appointmentId);
  await medplum.updateResource({
    ...fresh,
    ...(mirrorUid ? { identifier: upsertIdentifier(fresh.identifier, { system: CALDIY_IDENTIFIER.mirror, value: mirrorUid }) } : {}),
    extension: upsertExtension(fresh.extension, mirrorStateExtension(state)),
  });
}

export async function handler(medplum: MedplumClient, event: BotEvent<Appointment>): Promise<any> {
  const appointment = event.input;
  if (appointment?.resourceType !== 'Appointment' || !appointment.id) {
    return { skipped: 'not-an-appointment' };
  }
  // Defense in depth: the Subscription criteria already excludes these.
  if (identifierValue(appointment, CALDIY_IDENTIFIER.booking)) {
    return { skipped: 'caldiy-origin' };
  }
  const status = appointment.status ?? '';
  if (!OCCUPYING.has(status) && !RELEASING.has(status)) {
    return { skipped: `status-${status || 'unknown'}` };
  }
  if (!appointment.start || !appointment.end) {
    return { skipped: 'no-time' };
  }

  const state: MirrorState = {
    start: appointment.start,
    end: appointment.end,
    status: OCCUPYING.has(status) ? 'booked' : 'cancelled',
  };
  const previous = getMirrorState(appointment);
  if (previous && previous.start === state.start && previous.end === state.end && previous.status === state.status) {
    return { skipped: 'no-change' };
  }

  const config = caldiyConfigFromSecrets(event.secrets);
  if (!config) {
    return { skipped: 'not-configured' };
  }

  const mirrorUid = identifierValue(appointment, CALDIY_IDENTIFIER.mirror);

  // Nothing to release and nothing mirrored yet: just remember the state.
  if (state.status === 'cancelled' && !mirrorUid) {
    await stamp(medplum, appointment.id, state);
    return { skipped: 'nothing-to-cancel' };
  }

  if (mirrorUid) {
    if (state.status === 'cancelled') {
      await cancelBooking(config, mirrorUid, 'Cancelled in Premier Health');
      await stamp(medplum, appointment.id, state);
      return { action: 'cancelled', mirror: mirrorUid };
    }
    const rescheduled = await rescheduleBooking(config, mirrorUid, state.start as string, 'Rescheduled in Premier Health');
    await stamp(medplum, appointment.id, state, rescheduled.uid);
    return { action: 'rescheduled', mirror: rescheduled.uid };
  }

  // Create the mirror booking.
  const schedule = await resolveSchedule(medplum, appointment);
  const eventTypeId = schedule ? Number(identifierValue(schedule, CALDIY_IDENTIFIER.eventType)) : NaN;
  if (!schedule || !Number.isFinite(eventTypeId)) {
    return { skipped: 'no-event-type' };
  }
  const patientRef = getParticipantRef(appointment, 'Patient') as Reference<Patient> | undefined;
  const patient = patientRef ? await medplum.readReference(patientRef).catch(() => undefined) : undefined;
  if (!patient) {
    return { skipped: 'no-patient' };
  }
  const phone = patient.telecom?.find((t) => t.system === 'phone' && t.value)?.value;
  const email = patient.telecom?.find((t) => t.system === 'email' && t.value)?.value;
  const lengthInMinutes = Math.round((Date.parse(state.end as string) - Date.parse(state.start as string)) / 60_000);
  const serviceId = serviceIdOf(appointment);

  const booking = await createBooking(config, {
    start: state.start as string,
    eventTypeId,
    ...(lengthInMinutes > 0 ? { lengthInMinutes } : {}),
    attendee: {
      name: humanName(patient),
      email: email ?? `patient-${patient.id}@${PLACEHOLDER_EMAIL_DOMAIN}`,
      timeZone: CLINIC_TIMEZONE,
      ...(phone ? { phoneNumber: phone } : {}),
    },
    metadata: { source: MIRROR_SOURCE, appointmentId: appointment.id },
    ...(serviceId ? { bookingFieldsResponses: { service: serviceId } } : {}),
  });
  await stamp(medplum, appointment.id, state, booking.uid);
  return { action: 'created', mirror: booking.uid };
}
