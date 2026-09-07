// SPDX-FileCopyrightText: Copyright Premier Health Centres
// SPDX-License-Identifier: Apache-2.0
import { createReference, indexSearchParameterBundle, indexStructureDefinitionBundle } from '@medplum/core';
import { readJson, SEARCH_PARAMETER_BUNDLE_FILES } from '@medplum/definitions';
import type {
  Appointment,
  Bundle,
  HealthcareService,
  Location,
  Patient,
  Practitioner,
  Schedule,
  SearchParameter,
  Slot,
} from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { createHmac } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CaldiyWebhookBody } from './caldiy-webhook';
import { handler } from './caldiy-webhook';
import { CALDIY_IDENTIFIER } from './lib/caldiy';

const SECRET = 'whsec_test';
const EVENT_TYPE_ID = 42;

function sign(body: unknown): string {
  return createHmac('sha256', SECRET).update(JSON.stringify(body)).digest('hex');
}

function event(body: CaldiyWebhookBody, opts: { signed?: boolean; api?: boolean } = { signed: true }): any {
  return {
    input: body,
    contentType: 'application/json',
    headers: opts.signed ? { 'x-cal-signature-256': sign(body) } : {},
    secrets: {
      CALDIY_WEBHOOK_SECRET: { name: 'CALDIY_WEBHOOK_SECRET', valueString: SECRET },
      ...(opts.api
        ? {
            CALDIY_API_URL: { name: 'CALDIY_API_URL', valueString: 'http://caldiy-api:5555' },
            CALDIY_API_KEY: { name: 'CALDIY_API_KEY', valueString: 'cal_test' },
          }
        : {}),
    },
  };
}

function created(uid: string, overrides: Partial<NonNullable<CaldiyWebhookBody['payload']>> = {}): CaldiyWebhookBody {
  return {
    triggerEvent: 'BOOKING_CREATED',
    createdAt: '2026-09-07T10:00:00Z',
    payload: {
      uid,
      bookingId: 7,
      eventTypeId: EVENT_TYPE_ID,
      startTime: '2026-09-10T09:00:00Z',
      endTime: '2026-09-10T09:30:00Z',
      status: 'ACCEPTED',
      attendees: [{ name: 'Aminata Ngo', email: 'aminata@example.com', timeZone: 'Africa/Douala', phoneNumber: '6 50 00 00 00' }],
      responses: {
        name: { label: 'Name', value: 'Aminata Ngo' },
        email: { label: 'Email', value: 'aminata@example.com' },
        service: { label: 'Service', value: 'SERVICE_ID' },
        notes: { label: 'Notes', value: 'Chest pain since Monday' },
      },
      metadata: {},
      ...overrides,
    },
  };
}

describe('caldiy-webhook bot', () => {
  let medplum: MockClient;
  let practitioner: Practitioner;
  let site: Location;
  let service: HealthcareService;
  let schedule: Schedule;

  beforeAll(() => {
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-types.json') as Bundle);
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-resources.json') as Bundle);
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-medplum.json') as Bundle);
    for (const filename of SEARCH_PARAMETER_BUNDLE_FILES) {
      indexSearchParameterBundle(readJson(filename) as Bundle<SearchParameter>);
    }
  });

  beforeEach(async () => {
    medplum = new MockClient();
    practitioner = await medplum.createResource<Practitioner>({
      resourceType: 'Practitioner',
      name: [{ given: ['Paul'], family: 'Biya' }],
    });
    site = await medplum.createResource<Location>({ resourceType: 'Location', name: 'Douala Grand Mall' });
    service = await medplum.createResource<HealthcareService>({
      resourceType: 'HealthcareService',
      name: 'General consultation',
      type: [{ coding: [{ system: 'https://premierhealth.cm/fhir/CodeSystem/service-line', code: 'general-consultation' }] }],
    });
    schedule = await medplum.createResource<Schedule>({
      resourceType: 'Schedule',
      active: true,
      identifier: [{ system: CALDIY_IDENTIFIER.eventType, value: String(EVENT_TYPE_ID) }],
      actor: [createReference(practitioner), createReference(site)],
      serviceType: [
        {
          ...service.type?.[0],
          extension: [
            { url: 'https://medplum.com/fhir/service-type-reference', valueReference: createReference(service) },
          ],
        },
      ],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function withServiceId(body: CaldiyWebhookBody): CaldiyWebhookBody {
    const responses = body.payload?.responses as Record<string, { value: string }>;
    responses.service.value = service.id as string;
    return body;
  }

  test('creates patient, busy slot and appointment from a signed BOOKING_CREATED', async () => {
    const body = withServiceId(created('uid-1'));
    const result = await handler(medplum, event(body));
    expect(result.action).toBe('created');
    expect(result.verifiedBy).toBe('signature');

    const appointment = await medplum.readResource('Appointment', result.appointment);
    expect(appointment.status).toBe('booked');
    expect(appointment.identifier).toEqual([{ system: CALDIY_IDENTIFIER.booking, value: 'uid-1' }]);
    expect(appointment.participant.map((p) => p.actor?.reference)).toEqual([
      `Patient/${result.patient}`,
      `Practitioner/${practitioner.id}`,
      `Location/${site.id}`,
    ]);
    expect(appointment.comment).toBe('Chest pain since Monday');
    expect(appointment.serviceType?.[0]?.extension?.[0]?.valueReference?.reference).toBe(`HealthcareService/${service.id}`);

    const slot = await medplum.readReference(appointment.slot?.[0] as any);
    expect(slot).toMatchObject({ status: 'busy', start: '2026-09-10T09:00:00.000Z', schedule: { reference: `Schedule/${schedule.id}` } });

    const patient = await medplum.readResource('Patient', result.patient);
    expect(patient.name?.[0]).toEqual({ given: ['Aminata'], family: 'Ngo' });
    expect(patient.telecom?.find((t) => t.system === 'phone')?.value).toBe('+237650000000');

    // Redelivery is idempotent.
    const again = await handler(medplum, event(body));
    expect(again.action).toBe('exists');
  });

  test('matches an existing patient by phone', async () => {
    const existing = await medplum.createResource<Patient>({
      resourceType: 'Patient',
      name: [{ given: ['Aminata'], family: 'Ngo' }],
      telecom: [{ system: 'phone', value: '+237650000000' }],
    });
    const result = await handler(medplum, event(withServiceId(created('uid-2'))));
    expect(result.patient).toBe(existing.id);
  });

  test('ignores unverifiable payloads', async () => {
    const result = await handler(medplum, event(created('uid-3'), { signed: false }));
    expect(result).toEqual({ skipped: 'unverified' });
    expect(await medplum.searchOne('Appointment', { identifier: `${CALDIY_IDENTIFIER.booking}|uid-3` })).toBeUndefined();
  });

  test('falls back to re-fetching the booking from the API when the signature does not match', async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          status: 'success',
          data: {
            uid: 'uid-4',
            status: 'accepted',
            start: '2026-09-11T10:00:00Z',
            end: '2026-09-11T10:30:00Z',
            eventTypeId: EVENT_TYPE_ID,
            attendees: [{ name: 'Jean Mbarga', email: 'jean@example.com', timeZone: 'Africa/Douala', phoneNumber: '+237690000000' }],
            bookingFieldsResponses: { service: service.id },
            _url: url,
          },
        }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    // Tampered body: the signature was computed for a different payload.
    const body = created('uid-4', { startTime: '2026-09-11T08:00:00Z' });
    const evt = event(body, { signed: false, api: true });
    const result = await handler(medplum, evt);
    expect(result.action).toBe('created');
    expect(result.verifiedBy).toBe('api');
    expect(fetchMock).toHaveBeenCalledWith('http://caldiy-api:5555/v2/bookings/uid-4', expect.objectContaining({ method: 'GET' }));
    const appointment = await medplum.readResource('Appointment', result.appointment);
    // Data comes from the API, not the tampered payload.
    expect(appointment.start).toBe('2026-09-11T10:00:00.000Z');
  });

  test('skips echoes of mirror bookings', async () => {
    const result = await handler(medplum, event(created('uid-5', { metadata: { source: 'medplum', appointmentId: 'x' } })));
    expect(result).toEqual({ skipped: 'mirror' });
  });

  test('cancels the appointment and frees the slot on BOOKING_CANCELLED', async () => {
    const made = await handler(medplum, event(withServiceId(created('uid-6'))));
    const cancel: CaldiyWebhookBody = {
      ...created('uid-6', { cancellationReason: 'Cannot make it' }),
      triggerEvent: 'BOOKING_CANCELLED',
    };
    const result = await handler(medplum, event(cancel));
    expect(result.action).toBe('cancelled');
    const appointment = await medplum.readResource('Appointment', made.appointment);
    expect(appointment.status).toBe('cancelled');
    expect(appointment.cancelationReason?.text).toBe('Cannot make it');
    const slot = (await medplum.readReference(appointment.slot?.[0] as any)) as Slot;
    expect(slot.status).toBe('free');
  });

  test('moves the appointment and slot on BOOKING_RESCHEDULED', async () => {
    const made = await handler(medplum, event(withServiceId(created('uid-7'))));
    const reschedule = created('uid-8', {
      startTime: '2026-09-12T14:00:00Z',
      endTime: '2026-09-12T14:30:00Z',
      rescheduleUid: 'uid-7',
    });
    reschedule.triggerEvent = 'BOOKING_RESCHEDULED';
    const result = await handler(medplum, event(reschedule));
    expect(result).toMatchObject({ action: 'rescheduled', appointment: made.appointment });
    const appointment = await medplum.readResource('Appointment', made.appointment);
    expect(appointment.start).toBe('2026-09-12T14:00:00.000Z');
    expect(appointment.identifier).toEqual([{ system: CALDIY_IDENTIFIER.booking, value: 'uid-8' }]);
    const slot = await medplum.readReference(appointment.slot?.[0] as any);
    expect(slot).toMatchObject({ status: 'busy', start: '2026-09-12T14:00:00.000Z' });
  });

  test('raises a staff task when the event type is not mapped to a schedule', async () => {
    const result = await handler(medplum, event(created('uid-9', { eventTypeId: 999 })));
    expect(result).toEqual({ skipped: 'unmapped-event-type', eventTypeId: 999 });
    const task = await medplum.searchOne('Task', { identifier: `${CALDIY_IDENTIFIER.booking}-task|uid-9` });
    expect(task?.code?.coding?.[0]?.code).toBe('caldiy-unmapped-event-type');
  });

  test('ignores non-booking triggers', async () => {
    const result = await handler(medplum, event({ triggerEvent: 'MEETING_STARTED', payload: { uid: 'x' } }));
    expect(result).toEqual({ skipped: 'not-a-booking-event' });
  });

  test('appointments it creates are excluded from the mirror bot (caldiy-booking identifier)', async () => {
    const result = await handler(medplum, event(withServiceId(created('uid-10'))));
    const appointment = (await medplum.readResource('Appointment', result.appointment)) as Appointment;
    expect(appointment.identifier?.some((i) => i.system === CALDIY_IDENTIFIER.booking)).toBe(true);
  });
});
