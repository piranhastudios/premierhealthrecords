// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { indexSearchParameterBundle, indexStructureDefinitionBundle, unauthorized } from '@medplum/core';
import { readJson, SEARCH_PARAMETER_BUNDLE_FILES } from '@medplum/definitions';
import type { Bundle, Communication, Patient, Practitioner, SearchParameter } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { IDENTIFIER } from './lib/constants';
import { getEmailHeaders } from './lib/extensions';
import { handler } from './inbound-email';

describe('inbound-email bot', () => {
  let medplum: MockClient;
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
    medplum = new MockClient();
    triage = await medplum.createResource<Practitioner>({ resourceType: 'Practitioner', name: [{ family: 'Triage' }] });
  });

  function event(payload: Record<string, any>, token = 'shh'): any {
    return {
      bot: { reference: 'Bot/x' },
      input: payload,
      headers: { 'x-webhook-token': token },
      secrets: {
        INBOUND_EMAIL_SIGNING_SECRET: { name: 'INBOUND_EMAIL_SIGNING_SECRET', valueString: 'shh' },
        INBOUND_EMAIL_PROVIDER: { name: 'INBOUND_EMAIL_PROVIDER', valueString: 'generic' },
        TRIAGE_RECIPIENT: { name: 'TRIAGE_RECIPIENT', valueString: `Practitioner/${triage.id}` },
      },
      contentType: 'application/json',
    };
  }

  async function makePatient(): Promise<Patient> {
    return medplum.createResource<Patient>({
      resourceType: 'Patient',
      name: [{ given: ['Jane'], family: 'Doe' }],
      telecom: [{ system: 'email', value: 'jane@example.com' }],
    });
  }

  test('rejects when shared secret is wrong', async () => {
    const result = await handler(
      medplum,
      event({ from: 'jane@example.com', subject: 'Hi', messageId: '<m1@x>' }, 'nope')
    );
    expect(result).toEqual(unauthorized);
  });

  test('creates a thread + child with email headers for a known patient', async () => {
    const patient = await makePatient();
    const child = (await handler(
      medplum,
      event({
        from: 'Jane <jane@example.com>',
        to: 'care@premierhealth.cm',
        subject: 'Question',
        text: 'Hello',
        messageId: '<m1@x>',
      })
    )) as Communication;

    expect(child.sender?.reference).toBe(`Patient/${patient.id}`);
    expect(getEmailHeaders(child)?.messageId).toBe('<m1@x>');
    const headerId = (child.partOf?.[0]?.reference as string).split('/')[1];
    const header = await medplum.readResource('Communication', headerId);
    expect(header.identifier?.find((i) => i.system === IDENTIFIER.emailThreadRoot)?.value).toBe('<m1@x>');
  });

  test('threads replies via In-Reply-To', async () => {
    await makePatient();
    const first = (await handler(
      medplum,
      event({ from: 'jane@example.com', subject: 'Q', text: 'one', messageId: '<m1@x>' })
    )) as Communication;
    const second = (await handler(
      medplum,
      event({ from: 'jane@example.com', subject: 'Re: Q', text: 'two', messageId: '<m2@x>', inReplyTo: '<m1@x>' })
    )) as Communication;

    expect(second.partOf?.[0]?.reference).toBe(first.partOf?.[0]?.reference);
  });

  test('is idempotent on Message-ID', async () => {
    await makePatient();
    const a = (await handler(
      medplum,
      event({ from: 'jane@example.com', subject: 'Q', text: 'x', messageId: '<m1@x>' })
    )) as Communication;
    const b = (await handler(
      medplum,
      event({ from: 'jane@example.com', subject: 'Q', text: 'x', messageId: '<m1@x>' })
    )) as Communication;
    expect(b.id).toBe(a.id);
    const all = await medplum.searchResources('Communication', { identifier: `${IDENTIFIER.emailMessageId}|<m1@x>` });
    expect(all.length).toBe(1);
  });

  test('routes unknown senders to triage with a Task', async () => {
    const child = (await handler(
      medplum,
      event({ from: 'stranger@nowhere.com', subject: 'Hi', text: 'hello', messageId: '<m9@x>' })
    )) as Communication;
    const headerId = (child.partOf?.[0]?.reference as string).split('/')[1];
    const header = await medplum.readResource('Communication', headerId);
    expect(header.subject).toBeUndefined();
    const tasks = await medplum.searchResources('Task', { code: 'triage-message' });
    expect(tasks.length).toBe(1);
  });
});
