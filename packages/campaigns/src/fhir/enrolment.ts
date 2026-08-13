// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient, WithId } from '@medplum/core';
import { getExtension } from '@medplum/core';
import type { Basic, PlanDefinition, Resource, Task } from '@medplum/fhirtypes';
import {
  CAMPAIGN_NODE_SYSTEM,
  ENROLMENT_IDENTIFIER_SYSTEM,
  ENROLMENT_INPUT_SNAPSHOT,
  ENROLMENT_INPUT_TRIGGER_CONTEXT,
  ENROLMENT_RETRY_EXTENSION,
  TASK_CAMPAIGN_ENROLMENT,
  TASK_TYPE_SYSTEM,
} from '../constants';

/**
 * Stable enrolment identifier value: one active enrolment per patient per campaign.
 * @param planDefinitionId - The campaign PlanDefinition id.
 * @param patientId - The patient id.
 * @returns The identifier value.
 */
export function enrolmentIdentifierValue(planDefinitionId: string, patientId: string): string {
  return `${planDefinitionId}:${patientId}`;
}

export interface CreateEnrolmentOptions {
  campaign: WithId<PlanDefinition>;
  snapshot: WithId<Basic>;
  /** `Patient/{id}` reference. */
  patientRef: string;
  /** The resource that triggered enrolment (stored as `{resourceType, id}`). */
  triggerResource?: Resource;
  /** The node the enrolment starts at (first node after the trigger). */
  firstNodeId: string;
  /** When the executor should first pick this up (now for immediate). */
  wakeTime: Date;
}

/**
 * Creates an enrolment Task, deduplicated via conditional create on the
 * enrolment identifier — re-triggering never double-enrols.
 *
 * @param medplum - The Medplum client.
 * @param options - Enrolment parameters.
 * @returns The created (or pre-existing) Task.
 */
export async function createEnrolment(medplum: MedplumClient, options: CreateEnrolmentOptions): Promise<WithId<Task>> {
  const { campaign, snapshot, patientRef, triggerResource, firstNodeId, wakeTime } = options;
  const patientId = patientRef.split('/')[1];
  const identifierValue = enrolmentIdentifierValue(campaign.id, patientId);
  const task: Task = {
    resourceType: 'Task',
    status: 'in-progress',
    intent: 'order',
    code: { coding: [{ system: TASK_TYPE_SYSTEM, code: TASK_CAMPAIGN_ENROLMENT }] },
    identifier: [{ system: ENROLMENT_IDENTIFIER_SYSTEM, value: identifierValue }],
    for: { reference: patientRef },
    focus: { reference: `PlanDefinition/${campaign.id}` },
    businessStatus: { coding: [{ system: CAMPAIGN_NODE_SYSTEM, code: firstNodeId }] },
    executionPeriod: { start: new Date().toISOString(), end: wakeTime.toISOString() },
    authoredOn: new Date().toISOString(),
    input: [
      {
        type: { text: ENROLMENT_INPUT_SNAPSHOT },
        valueReference: { reference: `Basic/${snapshot.id}` },
      },
      ...(triggerResource?.id
        ? [
            {
              type: { text: ENROLMENT_INPUT_TRIGGER_CONTEXT },
              valueString: JSON.stringify({ resourceType: triggerResource.resourceType, id: triggerResource.id }),
            },
          ]
        : []),
    ],
  };
  return medplum.createResourceIfNoneExist<Task>(
    task,
    `identifier=${ENROLMENT_IDENTIFIER_SYSTEM}|${encodeURIComponent(identifierValue)}`
  );
}

/**
 * The current node id of an enrolment.
 * @param task - The enrolment Task.
 * @returns The node id, or undefined.
 */
export function getEnrolmentNode(task: Task): string | undefined {
  return task.businessStatus?.coding?.find((c) => c.system === CAMPAIGN_NODE_SYSTEM)?.code;
}

/**
 * The snapshot reference of an enrolment.
 * @param task - The enrolment Task.
 * @returns The `Basic/{id}` reference, or undefined.
 */
export function getEnrolmentSnapshotRef(task: Task): string | undefined {
  return task.input?.find((i) => i.type?.text === ENROLMENT_INPUT_SNAPSHOT)?.valueReference?.reference;
}

/**
 * The trigger-context `{resourceType, id}` of an enrolment, if recorded.
 * @param task - The enrolment Task.
 * @returns The trigger context, or undefined.
 */
export function getEnrolmentTriggerContext(task: Task): { resourceType: string; id: string } | undefined {
  const value = task.input?.find((i) => i.type?.text === ENROLMENT_INPUT_TRIGGER_CONTEXT)?.valueString;
  if (!value) {
    return undefined;
  }
  try {
    return JSON.parse(value) as { resourceType: string; id: string };
  } catch {
    return undefined;
  }
}

/**
 * Current retry count (0 when unset).
 * @param task - The enrolment Task.
 * @returns The retry count.
 */
export function getEnrolmentRetryCount(task: Task): number {
  return getExtension(task, ENROLMENT_RETRY_EXTENSION)?.valueInteger ?? 0;
}

/**
 * Returns a Task copy advanced to a node with a new wake time and reset retries.
 * @param task - The enrolment.
 * @param nodeId - The node to advance to.
 * @param wakeTime - When the executor should next process it.
 * @returns The updated Task (not persisted).
 */
export function advanceEnrolment(task: Task, nodeId: string, wakeTime: Date): Task {
  return {
    ...task,
    businessStatus: { coding: [{ system: CAMPAIGN_NODE_SYSTEM, code: nodeId }] },
    executionPeriod: { ...task.executionPeriod, end: wakeTime.toISOString() },
    extension: (task.extension ?? []).filter((e) => e.url !== ENROLMENT_RETRY_EXTENSION),
  };
}

/**
 * Returns a Task copy with retry count incremented and wake pushed back.
 * @param task - The enrolment.
 * @param wakeTime - The backoff wake time.
 * @returns The updated Task (not persisted).
 */
export function retryEnrolment(task: Task, wakeTime: Date): Task {
  const retries = getEnrolmentRetryCount(task) + 1;
  return {
    ...task,
    executionPeriod: { ...task.executionPeriod, end: wakeTime.toISOString() },
    extension: [
      ...(task.extension ?? []).filter((e) => e.url !== ENROLMENT_RETRY_EXTENSION),
      { url: ENROLMENT_RETRY_EXTENSION, valueInteger: retries },
    ],
  };
}
