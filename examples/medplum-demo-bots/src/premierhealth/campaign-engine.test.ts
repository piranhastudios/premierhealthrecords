// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import {
  BASIC_CAMPAIGN_SNAPSHOT,
  BASIC_TYPE_SYSTEM,
  CAMPAIGN_GRAPH_EXTENSION,
  CAMPAIGN_TEMPLATES_EXTENSION,
  CAMPAIGN_VERSION_EXTENSION,
  CONSENT_SCOPE_SYSTEM,
  EMAIL_EVENT_EXTENSION,
  PATIENT_TAG_SUPPRESSED,
  PATIENT_TAG_SYSTEM,
  PLAN_TYPE_SYSTEM,
  RESEND_IDENTIFIER_SYSTEM,
  TASK_CAMPAIGN_ENROLMENT,
  TASK_TYPE_SYSTEM,
  grantConsent,
  getEnrolmentNode,
} from '@medplum/campaigns';
import type { CampaignGraph } from '@medplum/campaigns';
import { indexSearchParameterBundle, indexStructureDefinitionBundle } from '@medplum/core';
import { readJson, SEARCH_PARAMETER_BUNDLE_FILES } from '@medplum/definitions';
import type { Basic, Bundle, Patient, PlanDefinition, SearchParameter } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { handler as executorHandler } from './campaign-executor';
import { handler as webhookHandler } from './campaign-resend-events';
import { handler as triggerHandler } from './campaign-trigger';

const SECRETS = {
  RESEND_API_KEY: { name: 'RESEND_API_KEY', valueString: 're_test' },
  RESEND_FROM_ADDRESS: { name: 'RESEND_FROM_ADDRESS', valueString: 'Test <t@example.com>' },
};

function graph(): CampaignGraph {
  return {
    schemaVersion: 1,
    settings: {},
    nodes: [
      { id: 't', type: 'trigger', config: { event: 'patient-created' } },
      { id: 's1', type: 'send', config: { templateId: 'tmpl-1', consentScope: 'marketing' } },
      { id: 'd1', type: 'delay', config: { duration: 'P3D' } },
      { id: 'x1', type: 'exit', config: {} },
    ],
    edges: [
      { source: 't', target: 's1' },
      { source: 's1', target: 'd1' },
      { source: 'd1', target: 'x1' },
    ],
  };
}

describe('campaign engine bots', () => {
  let medplum: MockClient;
  let campaign: PlanDefinition;

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
    campaign = await medplum.createResource<PlanDefinition>({
      resourceType: 'PlanDefinition',
      status: 'active',
      name: 'Welcome',
      type: { coding: [{ system: PLAN_TYPE_SYSTEM, code: 'campaign' }] },
      extension: [{ url: CAMPAIGN_GRAPH_EXTENSION, valueString: JSON.stringify(graph()) }],
    });
    await medplum.createResource<Basic>({
      resourceType: 'Basic',
      code: { coding: [{ system: BASIC_TYPE_SYSTEM, code: BASIC_CAMPAIGN_SNAPSHOT }] },
      subject: { reference: `PlanDefinition/${campaign.id}` },
      extension: [
        { url: CAMPAIGN_GRAPH_EXTENSION, valueString: JSON.stringify(graph()) },
        { url: CAMPAIGN_VERSION_EXTENSION, valueInteger: 1 },
        {
          url: CAMPAIGN_TEMPLATES_EXTENSION,
          valueString: JSON.stringify({
            'tmpl-1': { subject: 'Hi {{patient.name.given.first()}}', html: '<p>Hello {{patient.name.family}}</p>' },
          }),
        },
      ],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function createPatient(): Promise<Patient> {
    return medplum.createResource<Patient>({
      resourceType: 'Patient',
      name: [{ given: ['Ada'], family: 'Portal' }],
      telecom: [{ system: 'email', value: 'ada@example.com' }],
    });
  }

  test('trigger bot enrols a new patient once', async () => {
    const patient = await createPatient();
    const result = await triggerHandler(medplum, {
      bot: { reference: 'Bot/t' },
      input: patient,
      contentType: 'application/fhir+json',
      secrets: {},
    });
    expect(result.enrolled).toHaveLength(1);

    // Re-delivery does not double-enrol
    await triggerHandler(medplum, {
      bot: { reference: 'Bot/t' },
      input: patient,
      contentType: 'application/fhir+json',
      secrets: {},
    });
    const tasks = await medplum.searchResources('Task', [['code', `${TASK_TYPE_SYSTEM}|${TASK_CAMPAIGN_ENROLMENT}`]]);
    expect(tasks).toHaveLength(1);
    expect(getEnrolmentNode(tasks[0])).toBe('s1');
  });

  test('executor sends with consent, records Communication, advances through delay', async () => {
    const patient = await createPatient();
    await grantConsent(medplum, `Patient/${patient.id}`, 'marketing');
    await triggerHandler(medplum, {
      bot: { reference: 'Bot/t' },
      input: patient,
      contentType: 'application/fhir+json',
      secrets: {},
    });

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ id: 'resend-123' }), { status: 200 }));

    const result = await executorHandler(medplum, {
      bot: { reference: 'Bot/e' },
      input: {},
      contentType: 'application/fhir+json',
      secrets: SECRETS,
    });
    expect(result.sent).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.subject).toBe('Hi Ada');
    expect(body.html).toContain('Hello Portal');

    const communication = await medplum.searchOne('Communication', [
      ['identifier', `${RESEND_IDENTIFIER_SYSTEM}|resend-123`],
    ]);
    expect(communication?.status).toBe('completed');

    // Task advanced past the delay node with a future wake
    const task = (await medplum.searchResources('Task', [
      ['code', `${TASK_TYPE_SYSTEM}|${TASK_CAMPAIGN_ENROLMENT}`],
    ]))[0];
    expect(getEnrolmentNode(task)).toBe('x1');
    expect(new Date(task.executionPeriod?.end as string).getTime()).toBeGreaterThan(Date.now());
  });

  test('executor skips send without marketing consent', async () => {
    const patient = await createPatient();
    await triggerHandler(medplum, {
      bot: { reference: 'Bot/t' },
      input: patient,
      contentType: 'application/fhir+json',
      secrets: {},
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const result = await executorHandler(medplum, {
      bot: { reference: 'Bot/e' },
      input: {},
      contentType: 'application/fhir+json',
      secrets: SECRETS,
    });
    expect(result.sent).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    const communication = await medplum.searchOne('Communication', [['status', 'not-done']]);
    expect(communication?.statusReason?.text).toBe('consent-denied');
  });

  test('webhook bounce suppresses patient and cancels enrolments', async () => {
    const patient = await createPatient();
    await grantConsent(medplum, `Patient/${patient.id}`, 'marketing');
    await triggerHandler(medplum, {
      bot: { reference: 'Bot/t' },
      input: patient,
      contentType: 'application/fhir+json',
      secrets: {},
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 'resend-9' }), { status: 200 }));
    await executorHandler(medplum, {
      bot: { reference: 'Bot/e' },
      input: {},
      contentType: 'application/fhir+json',
      secrets: SECRETS,
    });

    const result = await webhookHandler(medplum, {
      bot: { reference: 'Bot/w' },
      input: { type: 'email.bounced', created_at: new Date().toISOString(), data: { email_id: 'resend-9' } },
      contentType: 'application/json',
      secrets: SECRETS,
    });
    expect(result.suppressed).toBe(true);

    const updated = await medplum.readResource('Patient', patient.id as string);
    expect(updated.meta?.tag?.some((t) => t.system === PATIENT_TAG_SYSTEM && t.code === PATIENT_TAG_SUPPRESSED)).toBe(
      true
    );
    const deny = await medplum.searchOne('Consent', [
      ['category', `${CONSENT_SCOPE_SYSTEM}|marketing`],
      ['_sort', '-_lastUpdated'],
    ]);
    expect(deny?.provision?.type).toBe('deny');
    const tasks = await medplum.searchResources('Task', [['code', `${TASK_TYPE_SYSTEM}|${TASK_CAMPAIGN_ENROLMENT}`]]);
    expect(tasks[0].status).toBe('cancelled');

    const communication = await medplum.searchOne('Communication', [
      ['identifier', `${RESEND_IDENTIFIER_SYSTEM}|resend-9`],
    ]);
    const eventExt = communication?.extension?.find((e) => e.url === EMAIL_EVENT_EXTENSION);
    expect(eventExt?.extension?.find((s) => s.url === 'type')?.valueCode).toBe('bounced');
  });
});
