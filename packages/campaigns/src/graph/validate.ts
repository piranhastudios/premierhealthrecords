// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { CampaignGraph, ConditionConfig, SendConfig, TriggerConfig } from './types';

export interface GraphValidationError {
  /** Node id the error anchors to, or undefined for graph-level errors. */
  nodeId?: string;
  message: string;
}

/**
 * Validates a campaign graph for activation. Returns an empty array when the
 * graph is executable. Rules: exactly one trigger; every node reachable from
 * the trigger; no cycles; condition nodes have both yes and no branches; send
 * nodes carry a template and consent scope; at least one exit reachable;
 * non-condition nodes have at most one outgoing edge.
 *
 * @param graph - The campaign graph to validate.
 * @returns Validation errors (empty = valid).
 */
export function validateGraph(graph: CampaignGraph): GraphValidationError[] {
  const errors: GraphValidationError[] = [];
  const nodeIds = new Set(graph.nodes.map((n) => n.id));

  if (nodeIds.size !== graph.nodes.length) {
    errors.push({ message: 'Duplicate node ids' });
  }

  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      errors.push({ message: `Edge references unknown node: ${edge.source} -> ${edge.target}` });
    }
  }

  const triggers = graph.nodes.filter((n) => n.type === 'trigger');
  if (triggers.length !== 1) {
    errors.push({ message: `Campaign must have exactly one trigger (found ${triggers.length})` });
  }

  for (const node of graph.nodes) {
    const outgoing = graph.edges.filter((e) => e.source === node.id);
    switch (node.type) {
      case 'trigger': {
        const config = node.config as TriggerConfig;
        if (!config.event) {
          errors.push({ nodeId: node.id, message: 'Trigger node is missing an event' });
        }
        if (outgoing.length !== 1) {
          errors.push({ nodeId: node.id, message: 'Trigger must have exactly one outgoing edge' });
        }
        break;
      }
      case 'send': {
        const config = node.config as SendConfig;
        if (!config.templateId) {
          errors.push({ nodeId: node.id, message: 'Send node is missing a template' });
        }
        if (!config.consentScope) {
          errors.push({ nodeId: node.id, message: 'Send node is missing a consent scope' });
        }
        if (outgoing.length !== 1) {
          errors.push({ nodeId: node.id, message: 'Send node must have exactly one outgoing edge' });
        }
        break;
      }
      case 'delay':
      case 'action': {
        if (outgoing.length !== 1) {
          errors.push({ nodeId: node.id, message: `${node.type} node must have exactly one outgoing edge` });
        }
        break;
      }
      case 'condition': {
        const config = node.config as ConditionConfig;
        const branches = new Set(outgoing.map((e) => e.branch));
        if (!branches.has('yes') || !branches.has('no') || outgoing.length !== 2) {
          errors.push({ nodeId: node.id, message: 'Condition node must have exactly a yes and a no branch' });
        }
        if ((config.check === 'email-opened' || config.check === 'email-clicked') && !config.ref) {
          errors.push({ nodeId: node.id, message: 'Condition must reference a prior send node' });
        }
        if (config.check === 'fhir-search' && !config.search) {
          errors.push({ nodeId: node.id, message: 'Condition is missing search criteria' });
        }
        if (config.check === 'ab-split' && (config.percentA === undefined || config.percentA < 0 || config.percentA > 100)) {
          errors.push({ nodeId: node.id, message: 'A/B split needs a percentage between 0 and 100' });
        }
        break;
      }
      case 'exit': {
        if (outgoing.length !== 0) {
          errors.push({ nodeId: node.id, message: 'Exit node cannot have outgoing edges' });
        }
        break;
      }
      default:
        errors.push({ nodeId: node.id, message: `Unknown node type: ${node.type as string}` });
    }
  }

  // Reachability + cycle detection from the trigger.
  if (triggers.length === 1) {
    const adjacency = new Map<string, string[]>();
    for (const edge of graph.edges) {
      adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
    }
    const visited = new Set<string>();
    const inStack = new Set<string>();
    let hasCycle = false;
    const visit = (id: string): void => {
      if (inStack.has(id)) {
        hasCycle = true;
        return;
      }
      if (visited.has(id)) {
        return;
      }
      visited.add(id);
      inStack.add(id);
      for (const next of adjacency.get(id) ?? []) {
        visit(next);
      }
      inStack.delete(id);
    };
    visit(triggers[0].id);

    if (hasCycle) {
      errors.push({ message: 'Campaign graph contains a cycle' });
    }
    for (const node of graph.nodes) {
      if (!visited.has(node.id)) {
        errors.push({ nodeId: node.id, message: 'Node is not reachable from the trigger' });
      }
    }
    if (!graph.nodes.some((n) => n.type === 'exit' && visited.has(n.id))) {
      errors.push({ message: 'Campaign must reach at least one exit node' });
    }
  }

  return errors;
}
