// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { createReference, indexSearchParameterBundle, indexStructureDefinitionBundle } from '@medplum/core';
import { readJson, SEARCH_PARAMETER_BUNDLE_FILES } from '@medplum/definitions';
import type {
  Bundle,
  ChargeItem,
  Encounter,
  Invoice,
  Patient,
  SearchParameter,
  ServiceRequest,
  Task,
} from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { handler } from './release-paid-tasks';

const TASK_BUSINESS_STATUS_SYSTEM = 'https://premierhealth.cm/fhir/CodeSystem/task-business-status';

describe('release-paid-tasks bot', () => {
  let medplum: MockClient;
  let patient: Patient;
  let encounter: Encounter;
  let serviceRequest: ServiceRequest;
  let blockedTask: Task;
  let chargeItem: ChargeItem;

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
    });
    encounter = await medplum.createResource<Encounter>({
      resourceType: 'Encounter',
      status: 'in-progress',
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' },
      subject: createReference(patient),
    });
    serviceRequest = await medplum.createResource<ServiceRequest>({
      resourceType: 'ServiceRequest',
      status: 'active',
      intent: 'order',
      code: { coding: [{ system: 'http://www.ama-assn.org/go/cpt', code: '93000', display: 'ECG' }] },
      subject: createReference(patient),
      encounter: createReference(encounter),
    });
    blockedTask = await medplum.createResource<Task>({
      resourceType: 'Task',
      status: 'on-hold',
      intent: 'order',
      businessStatus: {
        coding: [{ system: TASK_BUSINESS_STATUS_SYSTEM, code: 'awaiting-payment', display: 'Awaiting payment' }],
      },
      focus: createReference(serviceRequest),
      for: createReference(patient),
      encounter: createReference(encounter),
    });
    chargeItem = await medplum.createResource<ChargeItem>({
      resourceType: 'ChargeItem',
      status: 'planned',
      supportingInformation: [createReference(serviceRequest)],
      subject: createReference(patient),
      context: createReference(encounter),
      code: { coding: [{ system: 'http://www.ama-assn.org/go/cpt', code: '93000', display: 'ECG' }] },
      quantity: { value: 1 },
    });
  });

  async function createInvoice(status: Invoice['status']): Promise<Invoice> {
    return medplum.createResource<Invoice>({
      resourceType: 'Invoice',
      status,
      subject: createReference(patient),
      date: new Date().toISOString(),
      lineItem: [{ chargeItemReference: createReference(chargeItem) }],
      totalGross: { value: 5000, currency: 'XAF' },
    });
  }

  function event(input: Invoice): any {
    return {
      bot: { reference: 'Bot/x' },
      input,
      secrets: {},
      contentType: 'application/fhir+json',
    };
  }

  test('balanced invoice releases the matching on-hold awaiting-payment task', async () => {
    const invoice = await createInvoice('balanced');

    const result = await handler(medplum, event(invoice));

    expect(result.status).toBe('ok');
    expect(result.released).toEqual([`Task/${blockedTask.id}`]);

    const task = await medplum.readResource('Task', blockedTask.id as string);
    expect(task.status).toBe('ready');
    expect(task.businessStatus?.coding?.[0]).toMatchObject({
      system: TASK_BUSINESS_STATUS_SYSTEM,
      code: 'paid',
      display: 'Paid',
    });
  });

  test('non-balanced invoice is a no-op', async () => {
    const invoice = await createInvoice('issued');

    const result = await handler(medplum, event(invoice));

    expect(result).toEqual({ skipped: 'not-balanced' });
    const task = await medplum.readResource('Task', blockedTask.id as string);
    expect(task.status).toBe('on-hold');
    expect(task.businessStatus?.coding?.[0]?.code).toBe('awaiting-payment');
  });

  test('tasks not awaiting payment are untouched', async () => {
    // Same ServiceRequest focus, but on hold for an unrelated (non pay-gate) reason.
    const otherHold = await medplum.createResource<Task>({
      resourceType: 'Task',
      status: 'on-hold',
      intent: 'order',
      businessStatus: { coding: [{ system: 'http://example.org/other', code: 'clinical-hold' }] },
      focus: createReference(serviceRequest),
      for: createReference(patient),
      encounter: createReference(encounter),
    });
    // Same encounter, already in progress.
    const inProgress = await medplum.createResource<Task>({
      resourceType: 'Task',
      status: 'in-progress',
      intent: 'order',
      focus: createReference(serviceRequest),
      for: createReference(patient),
      encounter: createReference(encounter),
    });

    const invoice = await createInvoice('balanced');
    const result = await handler(medplum, event(invoice));

    // Only the pay-gated task is released.
    expect(result.released).toEqual([`Task/${blockedTask.id}`]);

    const untouchedHold = await medplum.readResource('Task', otherHold.id);
    expect(untouchedHold.status).toBe('on-hold');
    expect(untouchedHold.businessStatus?.coding?.[0]?.code).toBe('clinical-hold');

    const untouchedInProgress = await medplum.readResource('Task', inProgress.id);
    expect(untouchedInProgress.status).toBe('in-progress');
  });

  // Mirrors the bare, amount-only Invoice the provider app's billing components
  // (PaymentCollection / CardPaymentPanel) create when no ChargeItems are wired in.
  async function createBareInvoice(status: Invoice['status'], subject: Patient = patient): Promise<Invoice> {
    return medplum.createResource<Invoice>({
      resourceType: 'Invoice',
      status,
      subject: createReference(subject),
      date: new Date().toISOString(),
      totalGross: { value: 5000, currency: 'XAF' },
    });
  }

  test('bare invoice (no lineItems) falls back to releasing the patient pay-gated tasks', async () => {
    const invoice = await createBareInvoice('balanced');

    const result = await handler(medplum, event(invoice));

    expect(result.status).toBe('ok');
    expect(result.released).toEqual([`Task/${blockedTask.id}`]);

    const task = await medplum.readResource('Task', blockedTask.id as string);
    expect(task.status).toBe('ready');
    expect(task.businessStatus?.coding?.[0]).toMatchObject({
      system: TASK_BUSINESS_STATUS_SYSTEM,
      code: 'paid',
      display: 'Paid',
    });
  });

  test('bare invoice fallback only releases awaiting-payment tasks of the invoice subject', async () => {
    // Another patient with their own pay-gated task must be untouched.
    const otherPatient = await medplum.createResource<Patient>({
      resourceType: 'Patient',
      name: [{ given: ['John'], family: 'Smith' }],
    });
    const otherTask = await medplum.createResource<Task>({
      resourceType: 'Task',
      status: 'on-hold',
      intent: 'order',
      businessStatus: {
        coding: [{ system: TASK_BUSINESS_STATUS_SYSTEM, code: 'awaiting-payment', display: 'Awaiting payment' }],
      },
      for: createReference(otherPatient),
    });
    // Same patient, but on hold for a non pay-gate reason.
    const clinicalHold = await medplum.createResource<Task>({
      resourceType: 'Task',
      status: 'on-hold',
      intent: 'order',
      businessStatus: { coding: [{ system: 'http://example.org/other', code: 'clinical-hold' }] },
      for: createReference(patient),
    });

    const invoice = await createBareInvoice('balanced');
    const result = await handler(medplum, event(invoice));

    expect(result.released).toEqual([`Task/${blockedTask.id}`]);

    const untouchedOther = await medplum.readResource('Task', otherTask.id);
    expect(untouchedOther.status).toBe('on-hold');
    const untouchedHold = await medplum.readResource('Task', clinicalHold.id);
    expect(untouchedHold.status).toBe('on-hold');
  });

  test('bare non-balanced invoice is still a no-op', async () => {
    const invoice = await createBareInvoice('issued');

    const result = await handler(medplum, event(invoice));

    expect(result).toEqual({ skipped: 'not-balanced' });
    const task = await medplum.readResource('Task', blockedTask.id as string);
    expect(task.status).toBe('on-hold');
  });

  test('lineItem-based release is preferred: no cross-charge fallback when charges resolve', async () => {
    // A second pay-gated task for the same patient but a DIFFERENT service request,
    // not billed on this invoice — the precise ChargeItem path must not release it.
    const otherServiceRequest = await medplum.createResource<ServiceRequest>({
      resourceType: 'ServiceRequest',
      status: 'active',
      intent: 'order',
      code: { coding: [{ system: 'http://www.ama-assn.org/go/cpt', code: '80048', display: 'Basic metabolic panel' }] },
      subject: createReference(patient),
    });
    const unrelatedBlocked = await medplum.createResource<Task>({
      resourceType: 'Task',
      status: 'on-hold',
      intent: 'order',
      businessStatus: {
        coding: [{ system: TASK_BUSINESS_STATUS_SYSTEM, code: 'awaiting-payment', display: 'Awaiting payment' }],
      },
      focus: createReference(otherServiceRequest),
      for: createReference(patient),
    });

    const invoice = await createInvoice('balanced');
    const result = await handler(medplum, event(invoice));

    expect(result.released).toEqual([`Task/${blockedTask.id}`]);
    const untouched = await medplum.readResource('Task', unrelatedBlocked.id);
    expect(untouched.status).toBe('on-hold');
  });

  test('idempotent: re-running on an already-processed invoice changes nothing', async () => {
    const invoice = await createInvoice('balanced');

    const first = await handler(medplum, event(invoice));
    expect(first.released).toEqual([`Task/${blockedTask.id}`]);

    const afterFirst = await medplum.readResource('Task', blockedTask.id as string);

    const second = await handler(medplum, event(invoice));
    expect(second.released).toEqual([]);

    const afterSecond = await medplum.readResource('Task', blockedTask.id as string);
    expect(afterSecond.status).toBe('ready');
    expect(afterSecond.businessStatus?.coding?.[0]?.code).toBe('paid');
    expect(afterSecond.meta?.versionId).toBe(afterFirst.meta?.versionId);
  });
});
