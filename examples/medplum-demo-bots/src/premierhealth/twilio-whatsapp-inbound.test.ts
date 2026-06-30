// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import {
  getReferenceString,
  indexSearchParameterBundle,
  indexStructureDefinitionBundle,
  unauthorized,
} from '@medplum/core';
import { readJson, SEARCH_PARAMETER_BUNDLE_FILES } from '@medplum/definitions';
import type { Bundle, Communication, Patient, Practitioner, SearchParameter } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { validateRequest } from 'twilio/lib/webhooks/webhooks';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { IDENTIFIER } from './lib/constants';
import { getWhatsappWindowExpiresAt } from './lib/extensions';
import { handler } from './twilio-whatsapp-inbound';

vi.mock('twilio/lib/webhooks/webhooks', () => ({ validateRequest: vi.fn() }));

describe('twilio-whatsapp-inbound bot', () => {
  let medplum: MockClient;
  let bot: any;
  let triage: Practitioner;

  beforeAll(() => {
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-types.json') as Bundle);
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-resources.json') as Bundle);
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-medplum.json') as Bundle);
    for (const filename of SEARCH_PARAMETER_BUNDLE_FILES) {
      indexSearchParameterBundle(readJson(filename) as Bundle<SearchParameter>);
    }
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    medplum = new MockClient();
    bot = await medplum.createResource({ resourceType: 'Bot', name: 'WA Inbound' } as any);
    await medplum.createResource({
      resourceType: 'ProjectMembership',
      profile: getReferenceString(bot),
      project: { reference: 'Project/test' },
      user: { reference: 'User/test' },
    } as any);
    triage = await medplum.createResource<Practitioner>({ resourceType: 'Practitioner', name: [{ family: 'Triage' }] });
  });

  function event(params: Record<string, string>): any {
    return {
      bot: { reference: getReferenceString(bot) },
      input: params,
      headers: { 'x-twilio-signature': 'sig' },
      secrets: {
        TWILIO_AUTH_TOKEN: { name: 'TWILIO_AUTH_TOKEN', valueString: 'token' },
        TWILIO_ACCOUNT_SID: { name: 'TWILIO_ACCOUNT_SID', valueString: 'AC1' },
        TWILIO_WHATSAPP_NUMBER: { name: 'TWILIO_WHATSAPP_NUMBER', valueString: '+14155238886' },
        TRIAGE_RECIPIENT: { name: 'TRIAGE_RECIPIENT', valueString: getReferenceString(triage) },
      },
      contentType: 'application/x-www-form-urlencoded',
    };
  }

  test('rejects invalid Twilio signature', async () => {
    vi.mocked(validateRequest).mockReturnValue(false);
    const result = await handler(
      medplum,
      event({ From: 'whatsapp:+237650000000', Body: 'hi', MessageSid: 'SM1', NumMedia: '0' })
    );
    expect(result).toEqual(unauthorized);
  });

  test('creates a thread + child for a known patient and sets the 24h window', async () => {
    vi.mocked(validateRequest).mockReturnValue(true);
    const patient = await medplum.createResource<Patient>({
      resourceType: 'Patient',
      name: [{ given: ['Jane'], family: 'Doe' }],
      telecom: [{ system: 'phone', value: '+237650000000' }],
    });

    const child = (await handler(
      medplum,
      event({ From: 'whatsapp:+237650000000', Body: 'I need help', MessageSid: 'SM1', NumMedia: '0' })
    )) as Communication;

    expect(child.resourceType).toBe('Communication');
    expect(child.sender?.reference).toBe(getReferenceString(patient));
    expect(child.payload?.[0]?.contentString).toBe('I need help');
    expect(child.partOf?.[0]?.reference).toBeDefined();

    const headerId = (child.partOf?.[0]?.reference as string).split('/')[1];
    const header = await medplum.readResource('Communication', headerId);
    expect(getWhatsappWindowExpiresAt(header)).toBeDefined();
    expect(header.identifier?.find((i) => i.system === IDENTIFIER.whatsappConversation)?.value).toBe('+237650000000');
  });

  test('is idempotent on MessageSid', async () => {
    vi.mocked(validateRequest).mockReturnValue(true);
    await medplum.createResource<Patient>({
      resourceType: 'Patient',
      telecom: [{ system: 'phone', value: '+237650000000' }],
    });
    const first = (await handler(
      medplum,
      event({ From: 'whatsapp:+237650000000', Body: 'hi', MessageSid: 'SM1', NumMedia: '0' })
    )) as Communication;
    const second = (await handler(
      medplum,
      event({ From: 'whatsapp:+237650000000', Body: 'hi', MessageSid: 'SM1', NumMedia: '0' })
    )) as Communication;
    expect(second.id).toBe(first.id);
    const all = await medplum.searchResources('Communication', { identifier: `${IDENTIFIER.twilioMessage}|SM1` });
    expect(all.length).toBe(1);
  });

  test('routes unknown senders to triage with a Task', async () => {
    vi.mocked(validateRequest).mockReturnValue(true);
    const child = (await handler(
      medplum,
      event({ From: 'whatsapp:+237699999999', Body: 'who is this', MessageSid: 'SM9', NumMedia: '0' })
    )) as Communication;

    const headerId = (child.partOf?.[0]?.reference as string).split('/')[1];
    const header = await medplum.readResource('Communication', headerId);
    expect(header.subject).toBeUndefined();
    expect(header.category?.[0]?.coding?.[0]?.code).toBe('triage');
    const tasks = await medplum.searchResources('Task', { code: 'triage-message' });
    expect(tasks.length).toBe(1);
  });
});
