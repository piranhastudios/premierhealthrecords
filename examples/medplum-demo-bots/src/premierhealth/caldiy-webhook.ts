// SPDX-FileCopyrightText: Copyright Premier Health Centres
// SPDX-License-Identifier: Apache-2.0

/**
 * Cal.diy → Medplum webhook bot.
 *
 * Public webhook (`Bot.publicWebhook = true`; register the URL printed by
 * scripts/seed-subscriptions.mjs in Cal.diy → Settings → Developer → Webhooks with
 * the CALDIY_WEBHOOK_SECRET project secret) for BOOKING_CREATED,
 * BOOKING_RESCHEDULED and BOOKING_CANCELLED.
 *
 * Trust model: the HMAC header is checked over the reconstructed body first; when
 * that does not match (bots never see raw bytes) the booking is re-fetched by uid
 * from the Cal.diy API and only the re-fetched data is used. Nothing is written
 * from an unverifiable payload.
 *
 * Mapping: `payload.eventTypeId` → Schedule (identifier caldiy-event-type) →
 * practitioner + site. The booking question `service` carries the HealthcareService
 * id (or name). The attendee becomes / matches a Patient by phone, then email.
 *
 * Loop guards: bookings the mirror bot created in Cal.diy carry
 * `metadata.source = medplum` and their uid is stored as `caldiy-mirror` on the
 * Appointment; both are skipped here. Appointments created here carry the
 * `caldiy-booking` identifier, which the mirror bot's Subscription excludes.
 */

import type { BotEvent, MedplumClient, WithId } from '@medplum/core';
import type {
  Appointment,
  CodeableConcept,
  HealthcareService,
  Patient,
  Reference,
  Schedule,
  Slot,
} from '@medplum/fhirtypes';
import type { CaldiyBooking } from './lib/caldiy';
import {
  CALDIY_IDENTIFIER,
  MIRROR_SOURCE,
  caldiyConfigFromSecrets,
  getBooking,
  responseValue,
  verifyCaldiySignature,
} from './lib/caldiy';
import { normalizeE164 } from './lib/phone';
import { createStaffTask } from './lib/task';

const SERVICE_TYPE_REFERENCE_URL = 'https://medplum.com/fhir/service-type-reference';
const TRIGGERS = new Set(['BOOKING_CREATED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cal.com webhook payload (subset; both legacy and 2026 shapes). */
export interface CaldiyWebhookBody {
  triggerEvent?: string;
  createdAt?: string;
  payload?: {
    uid?: string;
    bookingId?: number;
    eventTypeId?: number;
    startTime?: string;
    endTime?: string;
    status?: string;
    attendees?: { name?: string; email?: string; timeZone?: string; phoneNumber?: string; language?: { locale?: string } | string }[];
    responses?: Record<string, unknown>;
    metadata?: Record<string, string>;
    cancellationReason?: string;
    rescheduleUid?: string;
    rescheduleStartTime?: string;
    rescheduleEndTime?: string;
    additionalNotes?: string;
    description?: string;
  };
}

/** Provider-agnostic view of a booking, whichever source it was verified from. */
export interface NormalizedBooking {
  uid: string;
  start: string;
  end: string;
  cancelled: boolean;
  eventTypeId?: number;
  attendee: { name: string; email?: string; phone?: string; language?: string };
  service?: string;
  notes?: string;
  cancellationReason?: string;
  rescheduledFromUid?: string;
}

function attendeePhone(attendee: { phoneNumber?: string } | undefined, responses: Record<string, unknown> | undefined): string | undefined {
  const raw = attendee?.phoneNumber ?? responseValue(responses, 'phone') ?? responseValue(responses, 'attendeePhoneNumber');
  return raw ? normalizeE164(raw) : undefined;
}

function attendeeLanguage(language: unknown): string | undefined {
  if (typeof language === 'string') {
    return language;
  }
  if (language && typeof language === 'object' && 'locale' in language) {
    return String((language as { locale?: string }).locale ?? '') || undefined;
  }
  return undefined;
}

export function normalizeWebhookPayload(payload: NonNullable<CaldiyWebhookBody['payload']>, trigger: string): NormalizedBooking | undefined {
  if (!payload.uid || !payload.startTime || !payload.endTime) {
    return undefined;
  }
  const attendee = payload.attendees?.[0];
  return {
    uid: payload.uid,
    start: new Date(payload.startTime).toISOString(),
    end: new Date(payload.endTime).toISOString(),
    cancelled: trigger === 'BOOKING_CANCELLED' || payload.status?.toLowerCase() === 'cancelled',
    eventTypeId: payload.eventTypeId,
    attendee: {
      name: attendee?.name ?? responseValue(payload.responses, 'name') ?? 'Website booking',
      email: attendee?.email ?? responseValue(payload.responses, 'email'),
      phone: attendeePhone(attendee, payload.responses),
      language: attendeeLanguage(attendee?.language),
    },
    service: responseValue(payload.responses, 'service'),
    notes: responseValue(payload.responses, 'notes') ?? payload.additionalNotes ?? payload.description,
    cancellationReason: payload.cancellationReason,
    rescheduledFromUid: payload.rescheduleUid,
  };
}

export function normalizeApiBooking(booking: CaldiyBooking, hint?: CaldiyWebhookBody['payload']): NormalizedBooking | undefined {
  if (!booking.uid || !booking.start || !booking.end) {
    return undefined;
  }
  const attendee = booking.attendees?.[0];
  const responses = booking.bookingFieldsResponses;
  return {
    uid: booking.uid,
    start: new Date(booking.start).toISOString(),
    end: new Date(booking.end).toISOString(),
    cancelled: booking.status?.toLowerCase() === 'cancelled',
    eventTypeId: booking.eventTypeId ?? booking.eventType?.id,
    attendee: {
      name: attendee?.name ?? responseValue(responses, 'name') ?? 'Website booking',
      email: attendee?.email ?? responseValue(responses, 'email'),
      phone: attendeePhone(attendee, responses),
      language: attendee?.language,
    },
    service: responseValue(responses, 'service'),
    notes: responseValue(responses, 'notes') ?? booking.description,
    cancellationReason: booking.cancellationReason,
    // The API does not always echo the previous uid; keep the (unverified) hint
    // only for looking up our own Appointment, never for data.
    rescheduledFromUid: booking.rescheduledFromUid ?? hint?.rescheduleUid,
  };
}

function splitName(full: string): { given: string[]; family?: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return { given: parts };
  }
  return { given: parts.slice(0, -1), family: parts[parts.length - 1] };
}

async function findOrCreatePatient(medplum: MedplumClient, attendee: NormalizedBooking['attendee']): Promise<Patient> {
  if (attendee.phone) {
    const byPhone =
      (await medplum.searchOne('Patient', { phone: attendee.phone })) ??
      (await medplum.searchOne('Patient', { telecom: attendee.phone }));
    if (byPhone) {
      return byPhone;
    }
  }
  if (attendee.email) {
    const byEmail = await medplum.searchOne('Patient', { email: attendee.email.trim().toLowerCase() });
    if (byEmail) {
      return byEmail;
    }
  }
  const name = splitName(attendee.name);
  return medplum.createResource<Patient>({
    resourceType: 'Patient',
    active: true,
    name: [{ given: name.given, ...(name.family ? { family: name.family } : {}) }],
    telecom: [
      ...(attendee.phone ? [{ system: 'phone' as const, value: attendee.phone, use: 'mobile' as const }] : []),
      ...(attendee.email ? [{ system: 'email' as const, value: attendee.email.trim().toLowerCase() }] : []),
    ],
    ...(attendee.language
      ? { communication: [{ language: { coding: [{ system: 'urn:ietf:bcp:47', code: attendee.language }] } }] }
      : {}),
    meta: { tag: [{ system: 'https://premierhealth.cm/fhir/CodeSystem/patient-source', code: 'website' }] },
  });
}

/** Resolve the booked service to one of the schedule's HealthcareServices. */
async function resolveService(
  medplum: MedplumClient,
  schedule: Schedule,
  service: string | undefined
): Promise<HealthcareService | undefined> {
  const refs = (schedule.serviceType ?? [])
    .map((concept) => concept.extension?.find((e) => e.url === SERVICE_TYPE_REFERENCE_URL)?.valueReference?.reference)
    .filter((ref): ref is string => Boolean(ref));
  if (refs.length === 0) {
    return undefined;
  }
  if (service && UUID_RE.test(service) && refs.includes(`HealthcareService/${service}`)) {
    return medplum.readResource('HealthcareService', service).catch(() => undefined);
  }
  const services = (
    await Promise.all(refs.map((ref) => medplum.readReference({ reference: ref } as Reference<HealthcareService>).catch(() => undefined)))
  ).filter((s): s is WithId<HealthcareService> => Boolean(s));
  if (service) {
    const wanted = service.trim().toLowerCase();
    const byName = services.find(
      (s) => s.name?.toLowerCase() === wanted || s.type?.[0]?.text?.toLowerCase() === wanted || s.type?.[0]?.coding?.[0]?.code === wanted
    );
    if (byName) {
      return byName;
    }
  }
  return services[0];
}

function toServiceType(service: HealthcareService): CodeableConcept[] {
  const extension = [{ url: SERVICE_TYPE_REFERENCE_URL, valueReference: { reference: `HealthcareService/${service.id}` } }];
  if (!service.type?.length) {
    return [{ extension }];
  }
  return service.type.map((concept) => ({ ...concept, extension: [...(concept.extension ?? []), ...extension] }));
}

async function freeSlots(medplum: MedplumClient, appointment: Appointment): Promise<void> {
  for (const slotRef of appointment.slot ?? []) {
    if (!slotRef.reference) {
      continue;
    }
    const slot = await medplum.readReference(slotRef as Reference<Slot>).catch(() => undefined);
    if (slot) {
      await medplum.updateResource({ ...slot, status: 'free' });
    }
  }
}

async function moveSlots(medplum: MedplumClient, appointment: Appointment, start: string, end: string): Promise<void> {
  for (const slotRef of appointment.slot ?? []) {
    if (!slotRef.reference) {
      continue;
    }
    const slot = await medplum.readReference(slotRef as Reference<Slot>).catch(() => undefined);
    if (slot) {
      await medplum.updateResource({ ...slot, start, end, status: 'busy' });
    }
  }
}

function findAppointmentByUid(medplum: MedplumClient, uid: string): Promise<Appointment | undefined> {
  return medplum.searchOne('Appointment', { identifier: `${CALDIY_IDENTIFIER.booking}|${uid}` });
}

export async function handler(medplum: MedplumClient, event: BotEvent<CaldiyWebhookBody>): Promise<any> {
  const body = event.input;
  const trigger = body?.triggerEvent ?? '';
  const payload = body?.payload;
  if (!TRIGGERS.has(trigger) || !payload?.uid) {
    return { skipped: 'not-a-booking-event' };
  }

  // Loop guard 1: echoes of the mirror bot's own bookings.
  if (payload.metadata?.source === MIRROR_SOURCE) {
    return { skipped: 'mirror' };
  }

  // Trust: HMAC over the reconstructed body, else re-fetch from the API.
  let booking: NormalizedBooking | undefined;
  let verifiedBy: 'signature' | 'api' | undefined;
  if (verifyCaldiySignature(event, event.secrets['CALDIY_WEBHOOK_SECRET']?.valueString)) {
    booking = normalizeWebhookPayload(payload, trigger);
    verifiedBy = 'signature';
  } else {
    const config = caldiyConfigFromSecrets(event.secrets);
    const fetched = config ? await getBooking(config, payload.uid).catch(() => undefined) : undefined;
    if (fetched) {
      booking = normalizeApiBooking(fetched, payload);
      verifiedBy = 'api';
    }
  }
  if (!booking) {
    console.error(`Cal.diy webhook for ${payload.uid} could not be verified; ignoring`);
    return { skipped: 'unverified' };
  }

  // Loop guard 2: a booking whose uid we created as a mirror.
  const mirrored = await medplum.searchOne('Appointment', { identifier: `${CALDIY_IDENTIFIER.mirror}|${booking.uid}` });
  if (mirrored) {
    return { skipped: 'mirror' };
  }

  // --- Cancellation ------------------------------------------------------------------
  if (trigger === 'BOOKING_CANCELLED' || booking.cancelled) {
    const appointment = await findAppointmentByUid(medplum, booking.uid);
    if (!appointment) {
      return { skipped: 'unknown-booking', uid: booking.uid };
    }
    if (appointment.status !== 'cancelled') {
      await medplum.updateResource<Appointment>({
        ...appointment,
        status: 'cancelled',
        ...(booking.cancellationReason ? { cancelationReason: { text: booking.cancellationReason } } : {}),
      });
      await freeSlots(medplum, appointment);
    }
    return { action: 'cancelled', appointment: appointment.id, verifiedBy };
  }

  // --- Reschedule (new uid; the previous booking is referenced) ----------------------
  if (trigger === 'BOOKING_RESCHEDULED') {
    const previous =
      (booking.rescheduledFromUid ? await findAppointmentByUid(medplum, booking.rescheduledFromUid) : undefined) ??
      (await findAppointmentByUid(medplum, booking.uid));
    if (previous) {
      const identifiers = (previous.identifier ?? []).filter((i) => i.system !== CALDIY_IDENTIFIER.booking);
      const updated = await medplum.updateResource<Appointment>({
        ...previous,
        status: 'booked',
        start: booking.start,
        end: booking.end,
        identifier: [...identifiers, { system: CALDIY_IDENTIFIER.booking, value: booking.uid }],
      });
      await moveSlots(medplum, updated, booking.start, booking.end);
      return { action: 'rescheduled', appointment: updated.id, verifiedBy };
    }
    // Unknown previous booking: fall through and create it.
  }

  // --- Create ----------------------------------------------------------------------------
  const existing = await findAppointmentByUid(medplum, booking.uid);
  if (existing) {
    return { action: 'exists', appointment: existing.id };
  }
  if (booking.eventTypeId === undefined) {
    return { skipped: 'no-event-type' };
  }
  const schedule = await medplum.searchOne('Schedule', {
    identifier: `${CALDIY_IDENTIFIER.eventType}|${booking.eventTypeId}`,
  });
  if (!schedule) {
    await createStaffTask(medplum, {
      code: 'caldiy-unmapped-event-type',
      display: 'Website booking could not be matched to a schedule',
      description: `Cal.diy booking ${booking.uid} (event type ${booking.eventTypeId}) for ${booking.attendee.name} at ${booking.start} has no Schedule with identifier ${CALDIY_IDENTIFIER.eventType}|${booking.eventTypeId}. Run scripts/seed-caldiy-links.mjs, then create the appointment manually.`,
      identifier: { system: `${CALDIY_IDENTIFIER.booking}-task`, value: booking.uid },
    });
    return { skipped: 'unmapped-event-type', eventTypeId: booking.eventTypeId };
  }

  const practitionerRef = schedule.actor.find((actor) => !actor.reference?.startsWith('Location/'));
  const locationRef = schedule.actor.find((actor) => actor.reference?.startsWith('Location/'));
  const patient = await findOrCreatePatient(medplum, booking.attendee);
  const service = await resolveService(medplum, schedule, booking.service);

  const slot = await medplum.createResource<Slot>({
    resourceType: 'Slot',
    status: 'busy',
    start: booking.start,
    end: booking.end,
    schedule: { reference: `Schedule/${schedule.id}` },
    ...(service ? { serviceType: toServiceType(service) } : {}),
  });

  const appointment = await medplum.createResourceIfNoneExist<Appointment>(
    {
      resourceType: 'Appointment',
      status: 'booked',
      identifier: [{ system: CALDIY_IDENTIFIER.booking, value: booking.uid }],
      start: booking.start,
      end: booking.end,
      slot: [{ reference: `Slot/${slot.id}` }],
      ...(service ? { serviceType: toServiceType(service) } : {}),
      ...(booking.notes ? { comment: booking.notes } : {}),
      participant: [
        { actor: { reference: `Patient/${patient.id}` }, status: 'accepted' },
        ...(practitionerRef ? [{ actor: practitionerRef, status: 'accepted' as const }] : []),
        ...(locationRef ? [{ actor: locationRef, status: 'accepted' as const }] : []),
      ],
      meta: { tag: [{ system: 'https://premierhealth.cm/fhir/CodeSystem/appointment-source', code: 'website' }] },
    },
    `identifier=${CALDIY_IDENTIFIER.booking}|${booking.uid}`
  );

  return { action: 'created', appointment: appointment.id, patient: patient.id, verifiedBy };
}
