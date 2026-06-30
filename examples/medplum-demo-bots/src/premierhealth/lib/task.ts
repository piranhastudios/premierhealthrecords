// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/** Helper for raising staff work-queue Tasks (delivery failures, inbound triage). */

import type { MedplumClient } from '@medplum/core';
import type { Reference, Task } from '@medplum/fhirtypes';
import { SYSTEM } from './constants';

export interface CreateTaskOptions {
  // Code from the Premier Health task-codes system, e.g. `delivery-failed`.
  code: string;
  display?: string;
  description: string;
  focus?: Reference;
  forRef?: Reference;
  // Optional idempotency identifier so retries don't duplicate the Task.
  identifier?: { system: string; value: string };
}

// Create a staff Task in the work queue (idempotent when an identifier is given).
export async function createStaffTask(medplum: MedplumClient, options: CreateTaskOptions): Promise<Task> {
  const task: Task = {
    resourceType: 'Task',
    status: 'requested',
    intent: 'order',
    code: { coding: [{ system: SYSTEM.taskCodes, code: options.code, display: options.display }] },
    description: options.description,
    ...(options.focus ? { focus: options.focus } : {}),
    ...(options.forRef ? { for: options.forRef } : {}),
    ...(options.identifier ? { identifier: [options.identifier] } : {}),
  };
  if (options.identifier) {
    return medplum.createResourceIfNoneExist(
      task,
      `identifier=${options.identifier.system}|${options.identifier.value}`
    );
  }
  return medplum.createResource(task);
}
