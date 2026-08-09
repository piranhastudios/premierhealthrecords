// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Campaign executor bot (cron, every 2 minutes — see scripts/seed-subscriptions.mjs).
 *
 * Picks up due campaign enrolments (Task code=campaign-enrolment,
 * status=in-progress, wake time in `executionPeriod.end` reached) and walks
 * each one through its campaign snapshot graph:
 *
 * - send:      consent check (scope from the node; skip as `not-done` when not
 *              permitted) → quiet-hours deferral → merge-field render → Resend →
 *              Communication (identifier = Resend id, topic = send-node id).
 *              Failures retry with backoff (5m/30m/2h) then park the Task on-hold.
 * - delay:     advance to the next node with wake = now + duration.
 * - condition: evaluate (email-opened/clicked from this enrolment's
 *              Communications' event extensions; fhir-search; deterministic
 *              a/b split) and follow the branch.
 * - action:    add/remove patient tag or raise a staff Task.
 * - exit:      mark the enrolment completed.
 *
 * Suppressed patients (email-suppressed tag) have their enrolments cancelled.
 * Nodes are processed in a loop per tick, so send → condition → send chains
 * don't pay a 2-minute hop per node; the loop stops at delays, deferrals,
 * failures, and exits. A step cap guards against malformed graphs.
 */

import type { BotEvent, MedplumClient, WithId } from '@medplum/core';
import type { Basic, Communication, Patient, Resource, Task } from '@medplum/fhirtypes';
import {
  CAMPAIGN_NODE_SYSTEM,
  COMMUNICATION_CATEGORY_SYSTEM,
  RESEND_IDENTIFIER_SYSTEM,
  RETRY_BACKOFF_MINUTES,
  TASK_CAMPAIGN_ENROLMENT,
  TASK_TYPE_SYSTEM,
  EMAIL_EVENT_EXTENSION,
  PATIENT_TAG_SYSTEM,
  advanceEnrolment,
  applyQuietHours,
  evaluateCondition,
  getEnrolmentNode,
  getEnrolmentRetryCount,
  getEnrolmentSnapshotRef,
  getEnrolmentTriggerContext,
  getNode,
  getSnapshotGraph,
  getSnapshotTemplates,
  isSendPermitted,
  isSuppressed,
  nextNodeId,
  parseIsoDuration,
  renderMergeFields,
  retryEnrolment,
} from '@medplum/campaigns';
import type {
  ActionConfig,
  CampaignGraph,
  CompiledTemplateMap,
  ConditionConfig,
  DelayConfig,
  SendConfig,
} from '@medplum/campaigns';
import { buildUnsubscribeUrl } from '@medplum/campaigns/node';
import { resendConfigFromSecrets, sendEmail } from './lib/resend';
import type { ResendConfig } from './lib/resend';

const MAX_STEPS_PER_TICK = 20;
const MAX_TASKS_PER_TICK = 50;

export async function handler(medplum: MedplumClient, event: BotEvent<any>): Promise<any> {
  const resend = resendConfigFromSecrets(event.secrets);
  // Unsubscribe links are generated per recipient — never operator-configured.
  // Absent secrets simply mean no link (seed-subscriptions provisions them).
  const unsubscribe: UnsubscribeConfig = {
    baseUrl: event.secrets['CAMPAIGN_UNSUBSCRIBE_URL']?.valueString,
    secret: event.secrets['CAMPAIGN_UNSUBSCRIBE_SECRET']?.valueString,
  };
  const now = new Date();

  // Fetch in-progress enrolments and filter due ones client-side: FHIR date
  // search on a period has interval semantics that make `period=le{now}` risky
  // (it can match on the period START). Clinic-scale counts make this cheap.
  const tasks = await medplum.searchResources('Task', [
    ['code', `${TASK_TYPE_SYSTEM}|${TASK_CAMPAIGN_ENROLMENT}`],
    ['status', 'in-progress'],
    ['_count', String(MAX_TASKS_PER_TICK * 4)],
    ['_sort', 'period'],
  ]);
  const due = tasks
    .filter((t) => t.executionPeriod?.end && new Date(t.executionPeriod.end).getTime() <= now.getTime())
    .slice(0, MAX_TASKS_PER_TICK);

  let sent = 0;
  let completed = 0;
  let errors = 0;
  for (const task of due) {
    try {
      const outcome = await processEnrolment(medplum, resend, task, unsubscribe);
      sent += outcome.sent;
      completed += outcome.completed ? 1 : 0;
    } catch (err) {
      errors++;
      console.error(`Enrolment ${task.id} failed:`, err);
    }
  }
  return { due: due.length, sent, completed, errors };
}

interface EnrolmentOutcome {
  sent: number;
  completed: boolean;
}

/** Project secrets backing the signed unsubscribe links. */
interface UnsubscribeConfig {
  baseUrl: string | undefined;
  secret: string | undefined;
}

async function processEnrolment(
  medplum: MedplumClient,
  resend: ResendConfig,
  task: WithId<Task>,
  unsubscribe: UnsubscribeConfig
): Promise<EnrolmentOutcome> {
  const outcome: EnrolmentOutcome = { sent: 0, completed: false };

  const patientRef = task.for?.reference;
  const snapshotRef = getEnrolmentSnapshotRef(task);
  if (!patientRef || !snapshotRef) {
    await medplum.updateResource<Task>({ ...task, status: 'failed', statusReason: { text: 'Malformed enrolment' } });
    return outcome;
  }

  const patient = await medplum.readReference<Patient>({ reference: patientRef });
  if (isSuppressed(patient)) {
    await medplum.updateResource<Task>({ ...task, status: 'cancelled', statusReason: { text: 'Email suppressed' } });
    return outcome;
  }

  const snapshot = await medplum.readReference<Basic>({ reference: snapshotRef });
  const graph = getSnapshotGraph(snapshot);
  if (!graph) {
    await medplum.updateResource<Task>({ ...task, status: 'failed', statusReason: { text: 'Missing snapshot graph' } });
    return outcome;
  }
  const templates = getSnapshotTemplates(snapshot);

  // Trigger context resource for merge fields (best effort).
  let triggerResource: Resource | undefined;
  const context = getEnrolmentTriggerContext(task);
  if (context) {
    triggerResource = await medplum
      .readResource(context.resourceType as Resource['resourceType'], context.id)
      .catch(() => undefined);
  }

  let current = task.businessStatus && getEnrolmentNode(task);
  const workingTask: Task = task;

  for (let step = 0; step < MAX_STEPS_PER_TICK; step++) {
    const node = current ? getNode(graph, current) : undefined;
    if (!node) {
      await medplum.updateResource<Task>({
        ...workingTask,
        status: 'failed',
        statusReason: { text: `Unknown node: ${current}` },
      });
      return outcome;
    }

    switch (node.type) {
      case 'exit': {
        await medplum.updateResource<Task>({
          ...workingTask,
          status: 'completed',
          lastModified: new Date().toISOString(),
        });
        outcome.completed = true;
        return outcome;
      }

      case 'delay': {
        const config = node.config as DelayConfig;
        const ms = parseIsoDuration(config.duration) ?? 0;
        const next = nextNodeId(graph, node.id);
        if (!next) {
          await medplum.updateResource<Task>({ ...workingTask, status: 'completed' });
          outcome.completed = true;
          return outcome;
        }
        await medplum.updateResource<Task>(advanceEnrolment(workingTask, next, new Date(Date.now() + ms)));
        return outcome;
      }

      case 'condition': {
        const branch = await evaluateConditionNode(medplum, graph, node.id, workingTask, patientRef);
        current = nextNodeId(graph, node.id, branch);
        continue;
      }

      case 'action': {
        await performAction(medplum, node.config as ActionConfig, patient, patientRef);
        current = nextNodeId(graph, node.id);
        continue;
      }

      case 'send': {
        const result = await performSend(medplum, resend, {
          node: node.id,
          config: node.config as SendConfig,
          graph,
          templates,
          task: workingTask,
          patient,
          patientRef,
          triggerResource,
          unsubscribe,
        });
        if (result === 'deferred') {
          return outcome; // wake already pushed to end of quiet hours
        }
        if (result === 'failed') {
          return outcome; // retry/on-hold already recorded
        }
        if (result === 'sent') {
          outcome.sent++;
        }
        current = nextNodeId(graph, node.id);
        continue;
      }

      default: {
        // trigger (or unknown) mid-graph — malformed
        await medplum.updateResource<Task>({
          ...workingTask,
          status: 'failed',
          statusReason: { text: `Unexpected node type at ${node.id}` },
        });
        return outcome;
      }
    }
  }

  await medplum.updateResource<Task>({
    ...workingTask,
    status: 'on-hold',
    statusReason: { text: 'Step limit reached (possible graph loop)' },
  });
  return outcome;
}

async function evaluateConditionNode(
  medplum: MedplumClient,
  graph: CampaignGraph,
  nodeId: string,
  task: Task,
  patientRef: string
): Promise<'yes' | 'no'> {
  const node = getNode(graph, nodeId);
  const config = node?.config as ConditionConfig;
  const opened = new Set<string>();
  const clicked = new Set<string>();

  if (config.check === 'email-opened' || config.check === 'email-clicked') {
    const communications = await medplum.searchResources('Communication', [
      ['part-of', `Task/${task.id}`],
      ['_count', '100'],
    ]);
    for (const communication of communications) {
      const sendNode = communication.topic?.coding?.find((c) => c.system === CAMPAIGN_NODE_SYSTEM)?.code;
      if (!sendNode) {
        continue;
      }
      for (const extension of communication.extension ?? []) {
        if (extension.url !== EMAIL_EVENT_EXTENSION) {
          continue;
        }
        const type = extension.extension?.find((e) => e.url === 'type')?.valueCode;
        if (type === 'opened') {
          opened.add(sendNode);
        }
        if (type === 'clicked') {
          clicked.add(sendNode);
          opened.add(sendNode); // a click implies an open even if the pixel was blocked
        }
      }
    }
  }

  let fhirSearchMatched: boolean | undefined;
  if (config.check === 'fhir-search' && config.search) {
    try {
      const [resourceType, params] = config.search.split('?');
      const query = `${params ? `${params}&` : ''}patient=${patientRef}&_summary=count`;
      const bundle = await medplum.search(resourceType as Resource['resourceType'], query);
      fhirSearchMatched = (bundle.total ?? 0) > 0;
    } catch (err) {
      console.error(`Condition ${nodeId}: search failed:`, err);
      fhirSearchMatched = false;
    }
  }

  return node
    ? evaluateCondition(node, {
        openedSendNodes: opened,
        clickedSendNodes: clicked,
        fhirSearchMatched,
        splitKey: task.id ?? '',
      })
    : 'no';
}

async function performAction(
  medplum: MedplumClient,
  config: ActionConfig,
  patient: WithId<Patient>,
  patientRef: string
): Promise<void> {
  switch (config.op) {
    case 'add-tag': {
      if (!config.tag) {
        return;
      }
      const tags = patient.meta?.tag ?? [];
      if (tags.some((t) => t.system === PATIENT_TAG_SYSTEM && t.code === config.tag)) {
        return;
      }
      await medplum.updateResource<Patient>({
        ...patient,
        meta: { ...patient.meta, tag: [...tags, { system: PATIENT_TAG_SYSTEM, code: config.tag }] },
      });
      return;
    }
    case 'remove-tag': {
      if (!config.tag) {
        return;
      }
      const tags = patient.meta?.tag ?? [];
      if (!tags.some((t) => t.system === PATIENT_TAG_SYSTEM && t.code === config.tag)) {
        return;
      }
      await medplum.updateResource<Patient>({
        ...patient,
        meta: {
          ...patient.meta,
          tag: tags.filter((t) => !(t.system === PATIENT_TAG_SYSTEM && t.code === config.tag)),
        },
      });
      return;
    }
    case 'create-task': {
      await medplum.createResource<Task>({
        resourceType: 'Task',
        status: 'requested',
        intent: 'order',
        description: config.taskDescription ?? 'Campaign follow-up',
        for: { reference: patientRef },
        authoredOn: new Date().toISOString(),
      });
      break;
    }
    default:
      break;
  }
}

interface SendContext {
  node: string;
  config: SendConfig;
  graph: CampaignGraph;
  templates: CompiledTemplateMap;
  task: Task;
  patient: WithId<Patient>;
  patientRef: string;
  triggerResource: Resource | undefined;
  unsubscribe: UnsubscribeConfig;
}

async function performSend(
  medplum: MedplumClient,
  resend: ResendConfig,
  context: SendContext
): Promise<'sent' | 'skipped' | 'deferred' | 'failed'> {
  const { node, config, graph, templates, task, patient, patientRef, triggerResource } = context;

  // Consent is checked at SEND time so mid-campaign revocation takes effect.
  const permitted = await isSendPermitted(medplum, patientRef, config.consentScope);
  if (!permitted) {
    await createSendCommunication(medplum, context, 'not-done', 'consent-denied');
    return 'skipped';
  }

  const email = patient.telecom?.find((t) => t.system === 'email')?.value;
  if (!email) {
    await createSendCommunication(medplum, context, 'not-done', 'no-email-address');
    return 'skipped';
  }

  // Quiet hours: defer the wake to the end of the window, stay on this node.
  const nowDate = new Date();
  const adjusted = applyQuietHours(nowDate, graph.settings);
  if (adjusted.getTime() > nowDate.getTime()) {
    await medplum.updateResource<Task>({
      ...task,
      executionPeriod: { ...task.executionPeriod, end: adjusted.toISOString() },
    });
    return 'deferred';
  }

  const template = templates[config.templateId];
  // The signed unsubscribe link is generated per recipient and substituted for
  // the reserved {{unsubscribe}} field in the template's locked footer.
  const unsubscribeUrl = buildUnsubscribeUrl(patient.id, context.unsubscribe.baseUrl, context.unsubscribe.secret);
  const renderContext = { patient, resource: triggerResource, unsubscribeUrl };
  try {
    if (!template) {
      throw new Error(`Snapshot is missing template ${config.templateId}`);
    }
    const result = await sendEmail(resend, {
      to: email,
      subject: renderMergeFields(config.subject ?? template.subject, renderContext),
      html: renderMergeFields(template.html, renderContext),
      // RFC 8058: gives Gmail/Outlook their native one-click Unsubscribe button,
      // which materially helps deliverability for marketing mail.
      ...(unsubscribeUrl && config.consentScope === 'marketing'
        ? {
            headers: {
              'List-Unsubscribe': `<${unsubscribeUrl}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
          }
        : {}),
    });
    await createSendCommunication(medplum, context, 'completed', undefined, result.id);
    return 'sent';
  } catch (err) {
    console.error(`Send failed for enrolment ${task.id} node ${node}:`, err);
    const retries = getEnrolmentRetryCount(task);
    if (retries >= RETRY_BACKOFF_MINUTES.length) {
      await medplum.updateResource<Task>({
        ...task,
        status: 'on-hold',
        statusReason: { text: `Send failed after retries: ${err instanceof Error ? err.message : 'error'}` },
      });
    } else {
      const wake = new Date(Date.now() + RETRY_BACKOFF_MINUTES[retries] * 60_000);
      await medplum.updateResource<Task>(retryEnrolment(task, wake));
    }
    return 'failed';
  }
}

async function createSendCommunication(
  medplum: MedplumClient,
  context: SendContext,
  status: Communication['status'],
  reason?: string,
  resendId?: string
): Promise<void> {
  const { node, config, task, patientRef } = context;
  await medplum.createResource<Communication>({
    resourceType: 'Communication',
    status,
    ...(reason ? { statusReason: { text: reason } } : {}),
    category: [{ coding: [{ system: COMMUNICATION_CATEGORY_SYSTEM, code: config.consentScope }] }],
    medium: [
      {
        coding: [
          { system: 'http://terminology.hl7.org/CodeSystem/v3-ParticipationMode', code: 'EMAILWRIT', display: 'email' },
        ],
      },
    ],
    subject: { reference: patientRef },
    recipient: [{ reference: patientRef }],
    ...(task.id ? { partOf: [{ reference: `Task/${task.id}` }] } : {}),
    ...(task.focus?.reference ? { basedOn: [{ reference: task.focus.reference }] } : {}),
    topic: { coding: [{ system: CAMPAIGN_NODE_SYSTEM, code: node }] },
    ...(resendId ? { identifier: [{ system: RESEND_IDENTIFIER_SYSTEM, value: resendId }] } : {}),
    sent: new Date().toISOString(),
  });
}
