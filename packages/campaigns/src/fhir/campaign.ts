// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient, WithId } from '@medplum/core';
import { createReference, getExtension } from '@medplum/core';
import type { Basic, PlanDefinition } from '@medplum/fhirtypes';
import {
  BASIC_CAMPAIGN_SNAPSHOT,
  BASIC_TYPE_SYSTEM,
  CAMPAIGN_GRAPH_EXTENSION,
  CAMPAIGN_TEMPLATES_EXTENSION,
  CAMPAIGN_VERSION_EXTENSION,
  PLAN_TYPE_CAMPAIGN,
  PLAN_TYPE_SYSTEM,
} from '../constants';
import type { CampaignGraph, CompiledTemplateMap } from '../graph/types';

/**
 * True when a PlanDefinition is a campaign (vs a care template).
 * @param planDefinition - The PlanDefinition to test.
 * @returns True for campaign PlanDefinitions.
 */
export function isCampaign(planDefinition: PlanDefinition): boolean {
  return Boolean(
    planDefinition.type?.coding?.some((c) => c.system === PLAN_TYPE_SYSTEM && c.code === PLAN_TYPE_CAMPAIGN)
  );
}

/** The campaign type coding to stamp on campaign PlanDefinitions. */
export const CAMPAIGN_TYPE_CODING = {
  coding: [{ system: PLAN_TYPE_SYSTEM, code: PLAN_TYPE_CAMPAIGN, display: 'Campaign' }],
};

/**
 * Parses the working graph from a campaign PlanDefinition.
 * @param planDefinition - The campaign.
 * @returns The graph, or undefined when absent/corrupt.
 */
export function getCampaignGraph(planDefinition: PlanDefinition): CampaignGraph | undefined {
  const value = getExtension(planDefinition, CAMPAIGN_GRAPH_EXTENSION)?.valueString;
  if (!value) {
    return undefined;
  }
  try {
    return JSON.parse(value) as CampaignGraph;
  } catch {
    return undefined;
  }
}

/**
 * Returns a copy of the PlanDefinition with the working graph replaced.
 * @param planDefinition - The campaign.
 * @param graph - The new graph.
 * @returns The updated resource (not persisted).
 */
export function setCampaignGraph(planDefinition: PlanDefinition, graph: CampaignGraph): PlanDefinition {
  const extension = (planDefinition.extension ?? []).filter((e) => e.url !== CAMPAIGN_GRAPH_EXTENSION);
  extension.push({ url: CAMPAIGN_GRAPH_EXTENSION, valueString: JSON.stringify(graph) });
  return { ...planDefinition, extension };
}

/**
 * Creates an immutable activation snapshot for a campaign: the frozen graph
 * plus the compiled subject/HTML of every referenced template. In-flight
 * enrolments reference this Basic so later edits cannot affect them.
 *
 * @param medplum - The Medplum client.
 * @param campaign - The campaign PlanDefinition (with id).
 * @param graph - The validated graph to freeze.
 * @param version - The activation version number.
 * @param templates - Compiled templates keyed by template id.
 * @returns The created snapshot.
 */
export async function createCampaignSnapshot(
  medplum: MedplumClient,
  campaign: WithId<PlanDefinition>,
  graph: CampaignGraph,
  version: number,
  templates: CompiledTemplateMap
): Promise<WithId<Basic>> {
  return medplum.createResource<Basic>({
    resourceType: 'Basic',
    code: { coding: [{ system: BASIC_TYPE_SYSTEM, code: BASIC_CAMPAIGN_SNAPSHOT }] },
    subject: createReference(campaign),
    extension: [
      { url: CAMPAIGN_GRAPH_EXTENSION, valueString: JSON.stringify(graph) },
      { url: CAMPAIGN_VERSION_EXTENSION, valueInteger: version },
      { url: CAMPAIGN_TEMPLATES_EXTENSION, valueString: JSON.stringify(templates) },
    ],
  });
}

/**
 * Parses the frozen graph out of a snapshot Basic.
 * @param snapshot - The activation snapshot.
 * @returns The graph, or undefined when absent/corrupt.
 */
export function getSnapshotGraph(snapshot: Basic): CampaignGraph | undefined {
  const value = getExtension(snapshot, CAMPAIGN_GRAPH_EXTENSION)?.valueString;
  if (!value) {
    return undefined;
  }
  try {
    return JSON.parse(value) as CampaignGraph;
  } catch {
    return undefined;
  }
}

/**
 * Parses the frozen compiled templates out of a snapshot Basic.
 * @param snapshot - The activation snapshot.
 * @returns The compiled templates map (empty when absent).
 */
export function getSnapshotTemplates(snapshot: Basic): CompiledTemplateMap {
  const value = getExtension(snapshot, CAMPAIGN_TEMPLATES_EXTENSION)?.valueString;
  if (!value) {
    return {};
  }
  try {
    return JSON.parse(value) as CompiledTemplateMap;
  } catch {
    return {};
  }
}

/**
 * The most recent activation snapshot for a campaign.
 * @param medplum - The Medplum client.
 * @param planDefinitionId - The campaign id.
 * @returns The newest snapshot, or undefined.
 */
export async function getLatestSnapshot(
  medplum: MedplumClient,
  planDefinitionId: string
): Promise<WithId<Basic> | undefined> {
  return medplum.searchOne('Basic', [
    ['code', BASIC_CAMPAIGN_SNAPSHOT],
    ['subject', `PlanDefinition/${planDefinitionId}`],
    ['_sort', '-_lastUpdated'],
  ]);
}
