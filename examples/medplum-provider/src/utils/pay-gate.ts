// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { CodeableConcept, Task } from '@medplum/fhirtypes';

/**
 * Pay-before-service gate.
 *
 * Investigation tasks (labs, ECG, etc.) that raise a billable ChargeItem are put
 * 'on-hold' with businessStatus 'awaiting-payment' at order time. The
 * `premierhealth-release-paid-tasks` bot flips them to 'ready' / 'paid' once the
 * covering Invoice is balanced. Keep the system/codes in sync with
 * examples/medplum-demo-bots/src/premierhealth/release-paid-tasks.ts.
 */

/** CodeSystem for Premier Health task business statuses. */
export const TASK_BUSINESS_STATUS_SYSTEM = 'https://premierhealth.cm/fhir/CodeSystem/task-business-status';

/** Business status code for a task blocked until its bill is paid. */
export const AWAITING_PAYMENT_CODE = 'awaiting-payment';

/** Business status code applied by the release bot once the invoice is balanced. */
export const PAID_CODE = 'paid';

/** businessStatus applied to a Task blocked until the linked bill is paid. */
export const AWAITING_PAYMENT_BUSINESS_STATUS: CodeableConcept = {
  coding: [{ system: TASK_BUSINESS_STATUS_SYSTEM, code: AWAITING_PAYMENT_CODE, display: 'Awaiting payment' }],
};

/**
 * Returns true when a Task is pay-gated: on hold awaiting payment of its bill.
 * @param task - The task to check.
 * @returns True when the task is on hold awaiting payment of its bill.
 */
export function isAwaitingPayment(task: Task): boolean {
  return (
    task.status === 'on-hold' &&
    Boolean(
      task.businessStatus?.coding?.some(
        (c) => c.system === TASK_BUSINESS_STATUS_SYSTEM && c.code === AWAITING_PAYMENT_CODE
      )
    )
  );
}
