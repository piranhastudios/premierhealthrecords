// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import {
  getReferenceString,
  indexSearchParameterBundle,
  indexStructureDefinitionBundle,
  unauthorized,
} from '@medplum/core';
import { readJson, SEARCH_PARAMETER_BUNDLE_FILES } from '@medplum/definitions';
import type { Bundle, Communication, SearchParameter } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { validateRequest } from 'twilio/lib/webhooks/webhooks';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { IDENTIFIER } from './lib/constants';
import { getDeliveryStatus } from './lib/extensions';
import { handler } from './twilio-status-callback';

vi.mock('twilio/lib/webhooks/webhooks', () => ({ validateRequest: vi.fn() }));

describe('twilio-status-callback bot', () => {
  let medplum: MockClient;
  let bot: any;

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
    bot = await medplum.createResource({ resourceType: 'Bot', name: 'Status CB' } as any);
    await medplum.createResource({
      resourceType: 'ProjectMembership',
      profile: getReferenceString(bot),
      project: { reference: 'Project/test' },
      user: { reference: 'User/test' },
    } as any);
  });

  function event(params: Record<string, string>): any {
    return {
      bot: { reference: getReferenceString(bot) },
      input: params,
      headers: { 'x-twilio-signature': 'sig' },
      secrets: { TWILIO_AUTH_TOKEN: { name: 'TWILIO_AUTH_TOKEN', valueString: 'token' } },
      contentType: 'application/x-www-form-urlencoded',
    };
  }

  test('rejects invalid signature', async () => {
    vi.mocked(validateRequest).mockReturnValue(false);
    const result = await handler(medplum, event({ MessageSid: 'SM1', MessageStatus: 'delivered' }));
    expect(result).toEqual(unauthorized);
  });

  test('advances delivery status on the matching message', async () => {
    vi.mocked(validateRequest).mockReturnValue(true);
    const message = await medplum.createResource<Communication>({
      resourceType: 'Communication',
      status: 'in-progress',
      identifier: [{ system: IDENTIFIER.twilioMessage, value: 'SM1' }],
    });
    const result = await handler(medplum, event({ MessageSid: 'SM1', MessageStatus: 'delivered' }));
    expect(result).toEqual({ status: 'delivered' });
    const updated = await medplum.readResource('Communication', message.id);
    expect(getDeliveryStatus(updated)).toBe('delivered');
  });

  test('ignores unknown SIDs and statuses', async () => {
    vi.mocked(validateRequest).mockReturnValue(true);
    expect(await handler(medplum, event({ MessageSid: 'SMx', MessageStatus: 'delivered' }))).toEqual({
      status: 'not-found',
    });
    expect(await handler(medplum, event({ MessageSid: 'SM1', MessageStatus: 'weird' }))).toEqual({ status: 'ignored' });
  });
});
