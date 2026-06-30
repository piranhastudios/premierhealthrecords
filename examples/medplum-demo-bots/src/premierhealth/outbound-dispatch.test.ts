// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { createReference, indexSearchParameterBundle, indexStructureDefinitionBundle } from '@medplum/core';
import { readJson, SEARCH_PARAMETER_BUNDLE_FILES } from '@medplum/definitions';
import type { Bundle, Communication, Patient, Practitioner, SearchParameter } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { getDeliveryStatus, getIdentifierValue } from './lib/extensions';
import { IDENTIFIER } from './lib/constants';
import { handler } from './outbound-dispatch';

const secrets = {
  TWILIO_ACCOUNT_SID: { name: 'TWILIO_ACCOUNT_SID', valueString: 'AC123' },
  TWILIO_AUTH_TOKEN: { name: 'TWILIO_AUTH_TOKEN', valueString: 'token' },
  TWILIO_WHATSAPP_NUMBER: { name: 'TWILIO_WHATSAPP_NUMBER', valueString: '+14155238886' },
  RESEND_API_KEY: { name: 'RESEND_API_KEY', valueString: 're_key' },
  RESEND_FROM_ADDRESS: { name: 'RESEND_FROM_ADDRESS', valueString: 'care@premierhealth.cm' },
};

describe('outbound-dispatch bot', () => {
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
      telecom: [
        { system: 'phone', value: '+237650000000' },
        { system: 'email', value: 'jane@example.com' },
      ],
    });
    practitioner = await medplum.createResource<Practitioner>({
      resourceType: 'Practitioner',
      name: [{ given: ['Staff'], family: 'Member' }],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function makeThread(channel: 'whatsapp' | 'email'): Promise<Communication> {
    return medplum.createResource<Communication>({
      resourceType: 'Communication',
      status: 'in-progress',
      subject: createReference(patient),
      recipient: [createReference(patient)],
      medium: [
        channel === 'whatsapp'
          ? { coding: [{ system: 'https://premierhealth.cm/fhir/CodeSystem/communication-channel', code: 'whatsapp' }] }
          : { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ParticipationMode', code: 'EMAILWRIT' }] },
      ],
    });
  }

  async function makeStaffMessage(thread: Communication, text: string): Promise<Communication> {
    return medplum.createResource<Communication>({
      resourceType: 'Communication',
      status: 'in-progress',
      sender: createReference(practitioner),
      partOf: [createReference(thread)],
      payload: [{ contentString: text }],
      sent: new Date().toISOString(),
    });
  }

  test('skips inbound (patient-sent) messages without sending', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const thread = await makeThread('whatsapp');
    const inbound = await medplum.createResource<Communication>({
      resourceType: 'Communication',
      status: 'in-progress',
      sender: createReference(patient),
      partOf: [createReference(thread)],
      payload: [{ contentString: 'hi' }],
    });
    const result = await handler(medplum, {
      bot: { reference: 'Bot/x' },
      input: inbound,
      secrets,
      contentType: 'application/fhir+json',
    } as any);
    expect(result).toEqual({ skipped: 'inbound' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('sends WhatsApp and writes back delivery status + sid', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ sid: 'SM1', status: 'queued' }),
    }));
    vi.stubGlobal('fetch', fetchMock as any);
    const thread = await makeThread('whatsapp');
    const message = await makeStaffMessage(thread, 'Hello from staff');

    await handler(medplum, {
      bot: { reference: 'Bot/x' },
      input: message,
      secrets,
      contentType: 'application/fhir+json',
    } as any);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = (fetchMock.mock.calls[0] as any[])[0] as string;
    expect(url).toContain('api.twilio.com');
    const updated = await medplum.readResource('Communication', message.id as string);
    expect(getIdentifierValue(updated, IDENTIFIER.twilioMessage)).toBe('SM1');
    expect(getDeliveryStatus(updated)).toBe('sent');
  });

  test('sends email via Resend with threading headers', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 're_1' }) }));
    vi.stubGlobal('fetch', fetchMock as any);
    const thread = await makeThread('email');
    const message = await makeStaffMessage(thread, 'Hello via email');

    await handler(medplum, {
      bot: { reference: 'Bot/x' },
      input: message,
      secrets,
      contentType: 'application/fhir+json',
    } as any);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0] as any[])[1].body);
    expect(body.to).toBe('jane@example.com');
    expect(body.headers['Message-ID']).toMatch(/@premierhealth\.cm>$/);
    const updated = await medplum.readResource('Communication', message.id as string);
    expect(getIdentifierValue(updated, IDENTIFIER.emailMessageId)).toBeDefined();
    expect(getDeliveryStatus(updated)).toBe('sent');
  });

  test('marks undeliverable and raises a Task when patient lacks the channel endpoint', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const noContact = await medplum.createResource<Patient>({ resourceType: 'Patient', name: [{ family: 'NoPhone' }] });
    const thread = await medplum.createResource<Communication>({
      resourceType: 'Communication',
      status: 'in-progress',
      subject: createReference(noContact),
      recipient: [createReference(noContact)],
      medium: [
        { coding: [{ system: 'https://premierhealth.cm/fhir/CodeSystem/communication-channel', code: 'whatsapp' }] },
      ],
    });
    const message = await makeStaffMessage(thread, 'Hi');

    await handler(medplum, {
      bot: { reference: 'Bot/x' },
      input: message,
      secrets,
      contentType: 'application/fhir+json',
    } as any);

    expect(fetchMock).not.toHaveBeenCalled();
    const updated = await medplum.readResource('Communication', message.id as string);
    expect(getDeliveryStatus(updated)).toBe('undeliverable');
    const tasks = await medplum.searchResources('Task', { code: 'delivery-failed' });
    expect(tasks.length).toBe(1);
  });
});
