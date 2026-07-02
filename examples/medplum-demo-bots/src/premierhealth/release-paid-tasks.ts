// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Release paid tasks bot (pay-before-service gate).
 *
 * Triggered by a Subscription on `Invoice` (update events). Investigation tasks
 * (labs, ECG, etc.) are created 'on-hold' with businessStatus 'awaiting-payment'
 * when a billable ChargeItem is raised for their ServiceRequest (see the provider
 * app's utils/encounter.ts + utils/pay-gate.ts). When the invoice covering those
 * charges is paid — the pawaPay/Stripe webhooks flip it to status 'balanced' —
 * this bot resolves the invoice's ChargeItems (lineItem[].chargeItemReference),
 * finds the blocked tasks via the ChargeItem's ServiceRequest (Task.focus) or,
 * failing that, its encounter (ChargeItem.context), and releases each one to
 * status 'ready' with businessStatus 'paid'.
 *
 * Fallback: front-desk checkout can create bare, amount-only invoices with no
 * lineItems (see the provider app's billing components). When a balanced invoice
 * has no resolvable ChargeItems, the bot instead releases every pay-gated task
 * for the invoice's subject patient — the payment settled the patient's bill.
 *
 * Idempotent: only tasks that are still on-hold + awaiting-payment are touched,
 * so re-delivery of an already-processed balanced invoice changes nothing.
 */

import type { BotEvent, MedplumClient } from '@medplum/core';
import type { ChargeItem, Invoice, Reference, Task } from '@medplum/fhirtypes';

// Keep in sync with examples/medplum-provider/src/utils/pay-gate.ts (bots are self-contained).
const TASK_BUSINESS_STATUS_SYSTEM = 'https://premierhealth.cm/fhir/CodeSystem/task-business-status';
const AWAITING_PAYMENT_CODE = 'awaiting-payment';
const PAID_BUSINESS_STATUS = {
  coding: [{ system: TASK_BUSINESS_STATUS_SYSTEM, code: 'paid', display: 'Paid' }],
};

export async function handler(medplum: MedplumClient, event: BotEvent<Invoice>): Promise<any> {
  const invoice = event.input;

  // Only act once the invoice is fully paid.
  if (invoice.status !== 'balanced') {
    return { skipped: 'not-balanced' };
  }

  // Resolve the ChargeItems billed on this invoice.
  const chargeItemRefs = (invoice.lineItem ?? [])
    .map((item) => item.chargeItemReference)
    .filter((ref): ref is Reference<ChargeItem> => Boolean(ref?.reference?.startsWith('ChargeItem/')));

  const released: string[] = [];
  const seen = new Set<string>();
  let resolvedCharges = 0;

  for (const ref of chargeItemRefs) {
    let chargeItem: ChargeItem;
    try {
      chargeItem = await medplum.readReference(ref);
    } catch (err) {
      console.error(`Error reading ${ref.reference}:`, err);
      continue;
    }
    resolvedCharges++;

    await releaseTasks(medplum, await findBlockedTasks(medplum, chargeItem), seen, released);
  }

  // Fallback for bare (amount-only) invoices: no ChargeItem was resolvable, so
  // release the pay-gated tasks of the invoice's subject patient instead.
  if (resolvedCharges === 0) {
    await releaseTasks(medplum, await findBlockedTasksForPatient(medplum, invoice), seen, released);
  }

  return { status: 'ok', released };
}

// Flips each still-blocked task to 'ready' / 'paid', deduplicating across charges.
async function releaseTasks(
  medplum: MedplumClient,
  tasks: Task[],
  seen: Set<string>,
  released: string[]
): Promise<void> {
  for (const task of tasks) {
    if (!task.id || seen.has(task.id)) {
      continue;
    }
    seen.add(task.id);
    const updated = await medplum.updateResource<Task>({
      ...task,
      status: 'ready',
      businessStatus: PAID_BUSINESS_STATUS,
    });
    released.push(`Task/${updated.id}`);
  }
}

// Finds the pay-gated tasks a ChargeItem was blocking: prefer the precise link via
// the charge's ServiceRequest (Task.focus, stored in ChargeItem.supportingInformation);
// fall back to the charge's encounter (ChargeItem.context) when no ServiceRequest link exists.
async function findBlockedTasks(medplum: MedplumClient, chargeItem: ChargeItem): Promise<Task[]> {
  const serviceRequestRef = chargeItem.supportingInformation?.find((r) =>
    r.reference?.startsWith('ServiceRequest/')
  )?.reference;
  if (serviceRequestRef) {
    const tasks = await medplum.searchResources('Task', { focus: serviceRequestRef, status: 'on-hold' });
    return tasks.filter(isAwaitingPayment);
  }

  const encounterRef = chargeItem.context?.reference;
  if (encounterRef?.startsWith('Encounter/')) {
    const tasks = await medplum.searchResources('Task', { encounter: encounterRef, status: 'on-hold' });
    return tasks.filter(isAwaitingPayment);
  }

  return [];
}

// Fallback for bare invoices (no lineItems): every pay-gated task of the invoice's
// subject patient. The FHIR R4 'patient' search parameter targets Task.for, which
// the encounter/plan-definition flows set to the subject patient.
async function findBlockedTasksForPatient(medplum: MedplumClient, invoice: Invoice): Promise<Task[]> {
  const patientRef = invoice.subject?.reference;
  if (!patientRef?.startsWith('Patient/')) {
    return [];
  }
  const tasks = await medplum.searchResources('Task', {
    patient: patientRef,
    status: 'on-hold',
    'business-status': `${TASK_BUSINESS_STATUS_SYSTEM}|${AWAITING_PAYMENT_CODE}`,
  });
  return tasks.filter(isAwaitingPayment);
}

// True when a Task is pay-gated: on hold awaiting payment of its bill.
function isAwaitingPayment(task: Task): boolean {
  return (
    task.status === 'on-hold' &&
    Boolean(
      task.businessStatus?.coding?.some(
        (c) => c.system === TASK_BUSINESS_STATUS_SYSTEM && c.code === AWAITING_PAYMENT_CODE
      )
    )
  );
}
