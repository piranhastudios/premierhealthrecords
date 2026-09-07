// SPDX-FileCopyrightText: Copyright Premier Health Centres
// SPDX-License-Identifier: Apache-2.0
import { createReference, indexSearchParameterBundle, indexStructureDefinitionBundle } from '@medplum/core';
import { readJson, SEARCH_PARAMETER_BUNDLE_FILES } from '@medplum/definitions';
import type { Appointment, Bundle, Patient, Practitioner, SearchParameter } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { handler } from './appointment-reminders';
import { isReminderSent } from './lib/appointments';

const HOUR = 60 * 60 * 1000;

describe('appointment-reminders bot', () => {
  let medplum: MockClient;
  let patient: Patient;
  let practitioner: Practitioner;

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
    practitioner = await medplum.createResource<Practitioner>({
      resourceType: 'Practitioner',
      name: [{ given: ['Staff'], family: 'Member' }],
    });
  });

  function makeAppointment(startOffsetHours: number, status: Appointment['status'] = 'booked'): Promise<Appointment> {
    const start = new Date(Date.now() + startOffsetHours * HOUR);
    return medplum.createResource<Appointment>({
      resourceType: 'Appointment',
      status,
      start: start.toISOString(),
      end: new Date(start.getTime() + 30 * 60_000).toISOString(),
      participant: [
        { actor: createReference(patient), status: 'accepted' },
        { actor: createReference(practitioner), status: 'accepted' },
      ],
    });
  }

  test('reminds appointments ~24h out once, ignoring others', async () => {
    const tomorrow = await makeAppointment(24);
    await makeAppointment(2); // too soon
    await makeAppointment(72); // too far
    await makeAppointment(24, 'cancelled');

    const first = await handler(medplum, { input: {}, contentType: 'application/json', secrets: {} } as any);
    expect(first.queued).toBe(1);

    const stamped = await medplum.readResource('Appointment', tomorrow.id as string);
    expect(isReminderSent(stamped)).toBe(true);
    const notices = await medplum.searchResources('Communication', { 'based-on': `Appointment/${tomorrow.id}` });
    expect(notices).toHaveLength(1);
    expect(notices[0].payload?.[0]?.contentString).toContain('reminder: your appointment with Staff Member is tomorrow');

    const second = await handler(medplum, { input: {}, contentType: 'application/json', secrets: {} } as any);
    expect(second.queued).toBe(0);
    expect(second.skipped).toBeGreaterThanOrEqual(1);
  });
});
