// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { WithId } from '@medplum/core';
import { useMedplum } from '@medplum/react-hooks';
import type { Basic, PlanDefinition } from '@medplum/fhirtypes';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createCampaignSnapshot, getCampaignGraph, setCampaignGraph } from '../fhir/campaign';
import { getTemplateContent } from '../fhir/template';
import type { GraphValidationError } from '../graph/validate';
import { validateGraph } from '../graph/validate';
import type { CampaignGraph, CompiledTemplateMap, SendConfig } from '../graph/types';

/**
 * A fresh, empty campaign graph (trigger + exit, unconnected).
 * @returns The starter graph.
 */
export function emptyGraph(): CampaignGraph {
  return {
    schemaVersion: 1,
    settings: {},
    nodes: [
      { id: 'trigger', type: 'trigger', position: { x: 80, y: 160 }, config: { event: 'patient-created' } },
      { id: 'exit', type: 'exit', position: { x: 640, y: 160 }, config: {} },
    ],
    edges: [],
  };
}

export interface UseCampaignResult {
  campaign: WithId<PlanDefinition> | undefined;
  graph: CampaignGraph | undefined;
  /** Replaces the working graph (autosaved, debounced). */
  updateGraph: (graph: CampaignGraph) => void;
  /** Validation of the current working graph. */
  errors: GraphValidationError[];
  saving: boolean;
  /** Validate + freeze templates + snapshot + bump version + set active. Throws on validation failure. */
  activate: () => Promise<void>;
  /** Set status=retired (stops new enrolments; in-flight ones finish). */
  retire: () => Promise<void>;
  reload: () => void;
}

/**
 * Loads a campaign PlanDefinition, exposes its working graph with debounced
 * autosave, and implements the activation lifecycle (validate → freeze
 * referenced templates → snapshot Basic → version bump → status active).
 *
 * @param campaignId - The PlanDefinition id.
 * @returns Campaign builder state and actions.
 */
export function useCampaign(campaignId: string | undefined): UseCampaignResult {
  const medplum = useMedplum();
  const [campaign, setCampaign] = useState<WithId<PlanDefinition>>();
  const [graph, setGraph] = useState<CampaignGraph>();
  const [saving, setSaving] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latestGraph = useRef<CampaignGraph>(undefined);

  useEffect(() => {
    if (!campaignId) {
      return () => {};
    }
    let active = true;
    medplum
      .readResource('PlanDefinition', campaignId)
      .then((resource) => {
        if (active) {
          setCampaign(resource);
          setGraph(getCampaignGraph(resource) ?? emptyGraph());
        }
      })
      .catch(console.error);
    return () => {
      active = false;
    };
  }, [medplum, campaignId, reloadTick]);

  const persist = useCallback(async (): Promise<void> => {
    const current = latestGraph.current;
    if (!current) {
      return;
    }
    setSaving(true);
    try {
      const fresh = await medplum.readResource('PlanDefinition', campaignId as string);
      const updated = await medplum.updateResource(setCampaignGraph(fresh, current));
      setCampaign(updated);
    } catch (err) {
      console.error('Campaign autosave failed:', err);
    } finally {
      setSaving(false);
    }
  }, [medplum, campaignId]);

  const updateGraph = useCallback(
    (next: CampaignGraph): void => {
      setGraph(next);
      latestGraph.current = next;
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
      saveTimer.current = setTimeout(() => {
        persist().catch(console.error);
      }, 1500);
    },
    [persist]
  );

  // Flush pending autosave on unmount.
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        persist().catch(console.error);
      }
    };
  }, [persist]);

  const activate = useCallback(async (): Promise<void> => {
    const current = latestGraph.current ?? graph;
    if (!campaign || !current) {
      throw new Error('Campaign not loaded');
    }
    const validationErrors = validateGraph(current);
    if (validationErrors.length > 0) {
      throw new Error(`Campaign is not valid: ${validationErrors.map((e) => e.message).join('; ')}`);
    }

    // Freeze the compiled content of every referenced template into the snapshot.
    const templates: CompiledTemplateMap = {};
    for (const node of current.nodes) {
      if (node.type !== 'send') {
        continue;
      }
      const config = node.config as SendConfig;
      const template = await medplum.readResource('Basic', config.templateId).catch(() => undefined);
      const content = template ? getTemplateContent(template as Basic) : undefined;
      if (!content) {
        throw new Error(`Template ${config.templateId} (node ${node.id}) not found or has no compiled content`);
      }
      templates[config.templateId] = { subject: content.subject, html: content.html };
    }

    const version = (parseInt(campaign.version ?? '0', 10) || 0) + 1;
    // Persist the working graph first so the PlanDefinition matches the snapshot.
    const fresh = await medplum.readResource('PlanDefinition', campaign.id);
    const withGraph = setCampaignGraph(fresh, current);
    await createCampaignSnapshot(medplum, campaign, current, version, templates);
    const updated = await medplum.updateResource({
      ...withGraph,
      status: 'active',
      version: String(version),
    });
    setCampaign(updated);
  }, [medplum, campaign, graph]);

  const retire = useCallback(async (): Promise<void> => {
    if (!campaign) {
      return;
    }
    const fresh = await medplum.readResource('PlanDefinition', campaign.id);
    const updated = await medplum.updateResource({ ...fresh, status: 'retired' });
    setCampaign(updated);
  }, [medplum, campaign]);

  return {
    campaign,
    graph,
    updateGraph,
    errors: graph ? validateGraph(graph) : [],
    saving,
    activate,
    retire,
    reload: () => setReloadTick((t) => t + 1),
  };
}
