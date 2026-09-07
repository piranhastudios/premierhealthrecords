// SPDX-FileCopyrightText: Copyright Premier Health Centres
// SPDX-License-Identifier: Apache-2.0
import { createReference, indexSearchParameterBundle, indexStructureDefinitionBundle } from '@medplum/core';
import { readJson, SEARCH_PARAMETER_BUNDLE_FILES } from '@medplum/definitions';
import type { Appointment, Bundle, Location, Patient, Practitioner, Schedule, SearchParameter, Slot } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { getMirrorState, handler } from './caldiy-mirror';
import { CALDIY_IDENTIFIER } from './lib/caldiy';

const secrets = {
  CALDIY_API_URL: { name: 'CALDIY_API_URL', valueString: 'http://caldiy-api:5555/' },
  CALDIY_API_KEY: { name: 'CALDIY_API_KEY', valueString: 'cal_test' },
};

function apiResponse(data: unknown): any {
  return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'success', data }) };
}

describe('caldiy-mirror bot', () => {
  let medplum: MockClient;
  let patient: Patient;
  let practitioner: Practitioner;
  let site: Location;
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
    patient = await medplum.createResource<Patient>({
      resourceType: 'Patient',
      name: [{ given: ['Jane'], family: 'Doe' }],
      telecom: [{ system: 'phone', value: '+237650000000' }],
    });
    practitioner = await medplum.createResource<Practitioner>({ resourceType: 'Practitioner', name: [{ family: 'Biya' }] });
    site = await medplum.createResource<Location>({ resourceType: 'Location', name: 'Douala Grand Mall' });
    schedule = await medplum.createResource<Schedule>({
      resourceType: 'Schedule',
      active: true,
      identifier: [{ system: CALDIY_IDENTIFIER.eventType, value: '42' }],
      actor: [createReference(practitioner), createReference(site)],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function makeAppointment(overrides: Partial<Appointment> = {}): Promise<Appointment> {
    const slot = await medplum.createResource<Slot>({
      resourceType: 'Slot',
      status: 'busy',
      start: '2026-09-10T09:00:00.000Z',
      end: '2026-09-10T09:30:00.000Z',
      schedule: createReference(schedule),
    });
    return medplum.createResource<Appointment>({
      resourceType: 'Appointment',
      status: 'booked',
      start: '2026-09-10T09:00:00.000Z',
      end: '2026-09-10T09:30:00.000Z',
      slot: [createReference(slot)],
      participant: [
        { actor: createReference(patient), status: 'accepted' },
        { actor: createReference(practitioner), status: 'accepted' },
        { actor: createReference(site), status: 'accepted' },
      ],
      ...overrides,
    });
  }

  const run = (appointment: Appointment): Promise<any> =>
    handler(medplum, { input: appointment, contentType: 'application/fhir+json', secrets } as any);

  test('creates a mirror booking tagged as medplum-origin and stamps the appointment', async () => {
    const fetchMock = vi.fn(async () => apiResponse({ uid: 'mirror-1', start: '2026-09-10T09:00:00.000Z' }));
    vi.stubGlobal('fetch', fetchMock);

    const appointment = await makeAppointment();
    const result = await run(appointment);
    expect(result).toEqual({ action: 'created', mirror: 'mirror-1' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://caldiy-api:5555/v2/bookings');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer cal_test', 'cal-api-version': '2026-02-25' });
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      start: '2026-09-10T09:00:00.000Z',
      eventTypeId: 42,
      lengthInMinutes: 30,
      attendee: { name: 'Jane Doe', timeZone: 'Africa/Douala', phoneNumber: '+237650000000' },
      metadata: { source: 'medplum', appointmentId: appointment.id },
    });
    expect(body.attendee.email).toContain('@noreply.');

    const stamped = await medplum.readResource('Appointment', appointment.id as string);
    expect(stamped.identifier).toEqual([{ system: CALDIY_IDENTIFIER.mirror, value: 'mirror-1' }]);
    expect(getMirrorState(stamped)).toEqual({ start: appointment.start, end: appointment.end, status: 'booked' });

    // Its own write-back is a no-op.
    expect(await run(stamped)).toEqual({ skipped: 'no-change' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('cancels the mirror when the appointment is cancelled', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(apiResponse({ uid: 'mirror-2' }))
      .mockResolvedValueOnce(apiResponse({ uid: 'mirror-2', status: 'cancelled' }));
    vi.stubGlobal('fetch', fetchMock);

    const appointment = await makeAppointment();
    await run(appointment);
    const stamped = await medplum.readResource('Appointment', appointment.id as string);
    const cancelled = await medplum.updateResource({ ...stamped, status: 'cancelled' });
    const result = await run(cancelled);
    expect(result).toEqual({ action: 'cancelled', mirror: 'mirror-2' });
    expect(fetchMock.mock.calls[1][0]).toBe('http://caldiy-api:5555/v2/bookings/mirror-2/cancel');
    expect(getMirrorState(await medplum.readResource('Appointment', appointment.id as string))?.status).toBe('cancelled');
  });

  test('reschedules the mirror when the time moves', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(apiResponse({ uid: 'mirror-3' }))
      .mockResolvedValueOnce(apiResponse({ uid: 'mirror-3b' }));
    vi.stubGlobal('fetch', fetchMock);

    const appointment = await makeAppointment();
    await run(appointment);
    const stamped = await medplum.readResource('Appointment', appointment.id as string);
    const moved = await medplum.updateResource({
      ...stamped,
      start: '2026-09-11T10:00:00.000Z',
      end: '2026-09-11T10:30:00.000Z',
    });
    const result = await run(moved);
    expect(result).toEqual({ action: 'rescheduled', mirror: 'mirror-3b' });
    expect(fetchMock.mock.calls[1][0]).toBe('http://caldiy-api:5555/v2/bookings/mirror-3/reschedule');
    const after = await medplum.readResource('Appointment', appointment.id as string);
    expect(after.identifier).toEqual([{ system: CALDIY_IDENTIFIER.mirror, value: 'mirror-3b' }]);
  });

  test('skips appointments that came from Cal.diy, unmapped schedules, and unconfigured projects', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const fromCaldiy = await makeAppointment({ identifier: [{ system: CALDIY_IDENTIFIER.booking, value: 'x' }] });
    expect(await run(fromCaldiy)).toEqual({ skipped: 'caldiy-origin' });

    const unmappedSchedule = await medplum.createResource<Schedule>({
      resourceType: 'Schedule',
      active: true,
      actor: [createReference(practitioner)],
    });
    const slot = await medplum.createResource<Slot>({
      resourceType: 'Slot',
      status: 'busy',
      start: '2026-09-10T09:00:00.000Z',
      end: '2026-09-10T09:30:00.000Z',
      schedule: createReference(unmappedSchedule),
    });
    const unmapped = await makeAppointment({ slot: [createReference(slot)], participant: [{ actor: createReference(patient), status: 'accepted' }] });
    expect(await run(unmapped)).toEqual({ skipped: 'no-event-type' });

    const plain = await makeAppointment();
    expect(await handler(medplum, { input: plain, contentType: 'application/fhir+json', secrets: {} } as any)).toEqual({
      skipped: 'not-configured',
    });

    const proposed = await makeAppointment({ status: 'proposed' });
    expect(await run(proposed)).toEqual({ skipped: 'status-proposed' });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a cancellation with nothing mirrored only records the state', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const cancelled = await makeAppointment({ status: 'cancelled' });
    expect(await run(cancelled)).toEqual({ skipped: 'nothing-to-cancel' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getMirrorState(await medplum.readResource('Appointment', cancelled.id as string))?.status).toBe('cancelled');
  });
});
