// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Campaign trigger bot.
 *
 * Sits behind static Subscriptions (Patient, Appointment, Encounter, Consent —
 * see scripts/seed-subscriptions.mjs). For each incoming resource it finds the
 * active campaigns whose trigger matches (event type + optional FHIRPath
 * filter) and enrols the resource's patient: one Task per patient per campaign,
 * deduplicated by a conditional create on the enrolment identifier, pinned to
 * the campaign's latest activation snapshot so later edits don't affect it.
 *
 * The enrolment starts at the first node after the trigger with an immediate
 * wake time; the executor bot (cron) performs the actual node processing.
 */

import type { BotEvent, MedplumClient } from '@medplum/core';
import { evalFhirPathTyped, toTypedValue } from '@medplum/core';
import type { Resource } from '@medplum/fhirtypes';
import {
  PLAN_TYPE_SYSTEM,
  PLAN_TYPE_CAMPAIGN,
  createEnrolment,
  firstNodeId,
  getCampaignGraph,
  getLatestSnapshot,
  getSnapshotGraph,
  getTriggerNode,
  matchingTriggerEvents,
} from '@medplum/campaigns';
import type { TriggerConfig } from '@medplum/campaigns';

export async function handler(medplum: MedplumClient, event: BotEvent<Resource>): Promise<any> {
  const resource = event.input;
  const matchedEvents = matchingTriggerEvents(resource);
  if (matchedEvents.length === 0) {
    return { skipped: 'no-trigger-event' };
  }

  const campaigns = await medplum.searchResources('PlanDefinition', [
    ['type', `${PLAN_TYPE_SYSTEM}|${PLAN_TYPE_CAMPAIGN}`],
    ['status', 'active'],
    ['_count', '100'],
  ]);
  if (campaigns.length === 0) {
    return { skipped: 'no-active-campaigns' };
  }

  const enrolled: string[] = [];
  for (const campaign of campaigns) {
    // The WORKING graph declares the trigger; execution uses the snapshot.
    const workingGraph = getCampaignGraph(campaign);
    const trigger = workingGraph ? getTriggerNode(workingGraph) : undefined;
    if (!trigger) {
      continue;
    }
    const config = trigger.config as TriggerConfig;
    const matched = matchedEvents.find((def) => def.event === config.event);
    if (!matched) {
      continue;
    }

    if (config.fhirPathFilter) {
      try {
        const results = evalFhirPathTyped(config.fhirPathFilter, [toTypedValue(resource)]);
        const value = results[0]?.value;
        if (!value) {
          continue;
        }
      } catch (err) {
        console.error(`Campaign ${campaign.id}: bad fhirPathFilter:`, err);
        continue;
      }
    }

    const patientRef = matched.patientRef(resource);
    if (!patientRef) {
      continue;
    }

    // Execute against the frozen activation snapshot, never the working copy.
    const snapshot = await getLatestSnapshot(medplum, campaign.id);
    if (!snapshot) {
      console.error(`Campaign ${campaign.id} is active but has no activation snapshot; skipping`);
      continue;
    }
    const snapshotGraph = getSnapshotGraph(snapshot);
    const startNode = snapshotGraph ? firstNodeId(snapshotGraph) : undefined;
    if (!startNode) {
      console.error(`Campaign ${campaign.id} snapshot has no start node; skipping`);
      continue;
    }

    const task = await createEnrolment(medplum, {
      campaign,
      snapshot,
      patientRef,
      triggerResource: resource,
      firstNodeId: startNode,
      wakeTime: new Date(),
    });
    enrolled.push(`${campaign.id}:${task.id}`);
  }

  return { enrolled };
}
