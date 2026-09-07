// SPDX-FileCopyrightText: Copyright Premier Health Centres
// SPDX-License-Identifier: Apache-2.0
import { createReference, indexSearchParameterBundle, indexStructureDefinitionBundle } from '@medplum/core';
import { readJson, SEARCH_PARAMETER_BUNDLE_FILES } from '@medplum/definitions';
import type { Appointment, Bundle, Location, Patient, Practitioner, SearchParameter } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { decideNotice, handler } from './appointment-notify';
import { APPOINTMENT_IDENTIFIER, getNotifiedState } from './lib/appointments';

describe('appointment-notify bot', () => {
  let medplum: MockClient;
  let patient: Patient;
  let practitioner: Practitioner;
  let site: Location;

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
      name: [{ given: ['Aminata'], family: 'Ngo' }],
      telecom: [{ system: 'phone', value: '+237650000000' }],
      communication: [{ language: { coding: [{ system: 'urn:ietf:bcp:47', code: 'fr' }] } }],
    });
    practitioner = await medplum.createResource<Practitioner>({
      resourceType: 'Practitioner',
      name: [{ prefix: ['Dr'], given: ['Paul'], family: 'Biya' }],
    });
    site = await medplum.createResource<Location>({ resourceType: 'Location', name: 'Douala Grand Mall' });
  });

  function makeAppointment(overrides: Partial<Appointment> = {}): Promise<Appointment> {
    return medplum.createResource<Appointment>({
      resourceType: 'Appointment',
      status: 'booked',
      start: '2026-09-10T09:00:00.000Z',
      end: '2026-09-10T09:30:00.000Z',
      participant: [
        { actor: createReference(patient), status: 'accepted' },
        { actor: createReference(practitioner), status: 'accepted' },
        { actor: createReference(site), status: 'accepted' },
      ],
      ...overrides,
    });
  }

  test('decideNotice covers the transitions', () => {
    expect(decideNotice(undefined, { status: 'booked', start: 'a', end: 'b' })).toBe('confirmed');
    expect(decideNotice({ status: 'booked', start: 'a', end: 'b' }, { status: 'booked', start: 'a', end: 'b' })).toBeUndefined();
    expect(decideNotice({ status: 'booked', start: 'a', end: 'b' }, { status: 'booked', start: 'c', end: 'd' })).toBe('rescheduled');
    expect(decideNotice({ status: 'booked', start: 'a', end: 'b' }, { status: 'cancelled', start: 'a', end: 'b' })).toBe('cancelled');
    expect(decideNotice(undefined, { status: 'cancelled' })).toBeUndefined();
    expect(decideNotice(undefined, { status: 'proposed' })).toBeUndefined();
    expect(decideNotice({ status: 'cancelled' }, { status: 'cancelled' })).toBeUndefined();
  });

  test('queues a French WhatsApp confirmation with the site and stamps the appointment', async () => {
    const appointment = await makeAppointment();
    const result = await handler(medplum, { input: appointment, contentType: 'application/fhir+json', secrets: {} } as any);
    expect(result.kind).toBe('confirmed');
    expect(result.status).toBe('queued');
    expect(result.channel).toBe('whatsapp');

    const notice = await medplum.searchOne('Communication', {
      identifier: `${APPOINTMENT_IDENTIFIER.notice}|${appointment.id}:confirmed:${appointment.start}`,
    });
    expect(notice).toBeDefined();
    expect(notice?.sender?.reference).toBe(`Practitioner/${practitioner.id}`);
    expect(notice?.partOf?.[0]?.reference).toMatch(/^Communication\//);
    const text = notice?.payload?.[0]?.contentString ?? '';
    expect(text).toContain('Bonjour Aminata Ngo');
    expect(text).toContain('Dr Paul Biya');
    expect(text).toContain('Douala Grand Mall');
    expect(text).toContain('confirmé');

    const stamped = await medplum.readResource('Appointment', appointment.id as string);
    expect(getNotifiedState(stamped)).toEqual({ start: appointment.start, end: appointment.end, status: 'booked' });
  });

  test('is a no-op when re-run on its own write-back', async () => {
    const appointment = await makeAppointment();
    await handler(medplum, { input: appointment, contentType: 'application/fhir+json', secrets: {} } as any);
    const stamped = await medplum.readResource('Appointment', appointment.id as string);
    const second = await handler(medplum, { input: stamped, contentType: 'application/fhir+json', secrets: {} } as any);
    expect(second).toEqual({ skipped: 'no-change' });
    const notices = await medplum.searchResources('Communication', { 'based-on': `Appointment/${appointment.id}` });
    expect(notices).toHaveLength(1);
  });

  test('sends a cancellation only after a confirmation, and a reschedule when the time moves', async () => {
    const appointment = await makeAppointment();
    await handler(medplum, { input: appointment, contentType: 'application/fhir+json', secrets: {} } as any);
    let current = await medplum.readResource('Appointment', appointment.id as string);

    const moved = await medplum.updateResource({
      ...current,
      start: '2026-09-11T10:00:00.000Z',
      end: '2026-09-11T10:30:00.000Z',
    });
    const rescheduled = await handler(medplum, { input: moved, contentType: 'application/fhir+json', secrets: {} } as any);
    expect(rescheduled.kind).toBe('rescheduled');

    current = await medplum.readResource('Appointment', appointment.id as string);
    const cancelled = await medplum.updateResource({ ...current, status: 'cancelled' });
    const cancelResult = await handler(medplum, { input: cancelled, contentType: 'application/fhir+json', secrets: {} } as any);
    expect(cancelResult.kind).toBe('cancelled');

    const notices = await medplum.searchResources('Communication', { 'based-on': `Appointment/${appointment.id}` });
    expect(notices.map((n) => n.payload?.[0]?.contentString ?? '')).toHaveLength(3);
  });

  test('never notifies a cancellation the patient was not told about', async () => {
    const appointment = await makeAppointment({ status: 'cancelled' });
    const result = await handler(medplum, { input: appointment, contentType: 'application/fhir+json', secrets: {} } as any);
    expect(result).toEqual({ skipped: 'no-change' });
  });

  test('uses English and email when the patient only has an email address', async () => {
    const emailPatient = await medplum.createResource<Patient>({
      resourceType: 'Patient',
      name: [{ given: ['John'], family: 'Doe' }],
      telecom: [{ system: 'email', value: 'john@example.com' }],
    });
    const appointment = await makeAppointment({
      participant: [
        { actor: createReference(emailPatient), status: 'accepted' },
        { actor: createReference(practitioner), status: 'accepted' },
      ],
    });
    const result = await handler(medplum, { input: appointment, contentType: 'application/fhir+json', secrets: {} } as any);
    expect(result.channel).toBe('email');
    const notice = await medplum.readResource('Communication', result.communication);
    expect(notice.payload?.[0]?.contentString).toContain('Hello John Doe, your appointment with Dr Paul Biya is confirmed');
  });

  test('attaches a WhatsApp template when the secret is configured', async () => {
    const appointment = await makeAppointment();
    const result = await handler(medplum, {
      input: appointment,
      contentType: 'application/fhir+json',
      secrets: { WHATSAPP_TEMPLATE_APPT_CONFIRMED_SID: { name: 'x', valueString: 'HX123' } },
    } as any);
    const notice = await medplum.readResource('Communication', result.communication);
    const template = notice.extension?.find((e) => e.url.endsWith('/whatsapp-template'));
    expect(template?.extension?.find((e) => e.url === 'sid')?.valueString).toBe('HX123');
  });

  test('skips appointments without a practitioner or patient', async () => {
    const noDoctor = await makeAppointment({ participant: [{ actor: createReference(patient), status: 'accepted' }] });
    expect(await handler(medplum, { input: noDoctor, contentType: 'application/fhir+json', secrets: {} } as any)).toEqual({
      skipped: 'no-practitioner',
    });
    const noPatient = await makeAppointment({ participant: [{ actor: createReference(practitioner), status: 'accepted' }] });
    expect(await handler(medplum, { input: noPatient, contentType: 'application/fhir+json', secrets: {} } as any)).toEqual({
      skipped: 'no-patient',
    });
  });
});
