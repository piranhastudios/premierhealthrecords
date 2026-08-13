// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Badge, Button, Group, Text } from '@mantine/core';
import type { Connection, Edge, EdgeChange, Node, NodeChange } from '@xyflow/react';
import { addEdge, applyEdgeChanges, applyNodeChanges, Background, Controls, MiniMap, ReactFlow } from '@xyflow/react';
import type { JSX } from 'react';
import { useCallback, useMemo } from 'react';
import type {
  ActionConfig,
  CampaignEdge,
  CampaignGraph,
  CampaignNode,
  CampaignNodeType,
  ConditionConfig,
  DelayConfig,
  ExitConfig,
  SendConfig,
  TriggerConfig,
} from '../graph/types';

/** Node palette metadata (label + accent color per node type). */
export const NODE_META: Record<CampaignNodeType, { label: string; color: string }> = {
  trigger: { label: 'Trigger', color: '#1f9d55' },
  send: { label: 'Send email', color: '#f47b20' },
  delay: { label: 'Delay', color: '#fdb913' },
  condition: { label: 'Condition', color: '#7048e8' },
  action: { label: 'Action', color: '#1c7ed6' },
  exit: { label: 'Exit', color: '#868e96' },
};

function nodeSummary(node: CampaignNode): string {
  switch (node.type) {
    case 'trigger':
      return (node.config as TriggerConfig).event ?? 'unconfigured';
    case 'send': {
      const config = node.config as SendConfig;
      return config.templateId ? `template ${config.templateId.slice(0, 8)}…` : 'no template';
    }
    case 'delay':
      return (node.config as DelayConfig).duration ?? 'no duration';
    case 'condition':
      return (node.config as ConditionConfig).check ?? 'unconfigured';
    case 'action':
      return (node.config as ActionConfig).op ?? 'unconfigured';
    case 'exit':
      return (node.config as ExitConfig).reason ?? '';
    default:
      return '';
  }
}

// Converts a campaign graph to React Flow nodes/edges.
function toFlow(graph: CampaignGraph, errorNodes: ReadonlySet<string>): { nodes: Node[]; edges: Edge[] } {
  return {
    nodes: graph.nodes.map((node, index) => ({
      id: node.id,
      position: node.position ?? { x: 120 + index * 180, y: 160 },
      data: { label: renderNodeLabel(node, errorNodes.has(node.id)) },
      style: {
        border: `2px solid ${errorNodes.has(node.id) ? '#c8102e' : NODE_META[node.type].color}`,
        borderRadius: 10,
        padding: 6,
        width: 170,
        background: 'var(--mantine-color-body, white)',
      },
    })),
    edges: graph.edges.map((edge) => ({
      id: `${edge.source}->${edge.target}:${edge.branch ?? ''}`,
      source: edge.source,
      target: edge.target,
      label: edge.branch,
      animated: true,
    })),
  };
}

function renderNodeLabel(node: CampaignNode, hasError: boolean): JSX.Element {
  const meta = NODE_META[node.type];
  return (
    <Group gap={6} wrap="nowrap">
      <Badge size="xs" variant="filled" color={hasError ? '#c8102e' : meta.color} style={{ flexShrink: 0 }}>
        {meta.label}
      </Badge>
      <Text size="xs" truncate>
        {nodeSummary(node)}
      </Text>
    </Group>
  );
}

export interface CampaignCanvasProps {
  graph: CampaignGraph;
  onChange: (graph: CampaignGraph) => void;
  /** Node the inspector is editing. */
  selectedNodeId: string | undefined;
  onSelectNode: (nodeId: string | undefined) => void;
  /** Node ids with validation errors (rendered with a red border). */
  errorNodeIds?: string[];
  readOnly?: boolean;
}

let nodeCounter = 0;

/**
 * The campaign graph canvas: React Flow rendering of the campaign nodes/edges
 * with a palette to add nodes. Edges out of condition nodes are auto-labelled
 * yes then no. All structural changes flow back through `onChange`.
 *
 * @param props - Graph, selection, and change callbacks.
 * @returns The canvas element.
 */
export function CampaignCanvas(props: CampaignCanvasProps): JSX.Element {
  const { graph, onChange, selectedNodeId, onSelectNode, errorNodeIds, readOnly } = props;
  const errorSet = useMemo(() => new Set(errorNodeIds ?? []), [errorNodeIds]);
  const { nodes, edges } = useMemo(() => toFlow(graph, errorSet), [graph, errorSet]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]): void => {
      const updated = applyNodeChanges(changes, nodes);
      const removed = new Set(changes.filter((c) => c.type === 'remove').map((c) => (c as { id: string }).id));
      const positions = new Map(updated.map((n) => [n.id, n.position]));
      onChange({
        ...graph,
        nodes: graph.nodes
          .filter((n) => !removed.has(n.id) || n.type === 'trigger') // the trigger cannot be deleted
          .map((n) => ({ ...n, position: positions.get(n.id) ?? n.position })),
        edges: graph.edges.filter((e) => !removed.has(e.source) && !removed.has(e.target)),
      });
    },
    [graph, nodes, onChange]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]): void => {
      const removed = new Set(changes.filter((c) => c.type === 'remove').map((c) => (c as { id: string }).id));
      if (removed.size === 0) {
        return;
      }
      onChange({
        ...graph,
        edges: graph.edges.filter((e) => !removed.has(`${e.source}->${e.target}:${e.branch ?? ''}`)),
      });
    },
    [graph, onChange]
  );

  const handleConnect = useCallback(
    (connection: Connection): void => {
      if (!connection.source || !connection.target) {
        return;
      }
      const sourceNode = graph.nodes.find((n) => n.id === connection.source);
      const existing = graph.edges.filter((e) => e.source === connection.source);
      let branch: CampaignEdge['branch'];
      if (sourceNode?.type === 'condition') {
        // First outgoing edge is yes, second is no.
        branch = existing.some((e) => e.branch === 'yes') ? 'no' : 'yes';
        if (existing.length >= 2) {
          return; // both branches connected
        }
      } else if (existing.length >= 1) {
        return; // non-condition nodes have one outgoing edge
      }
      onChange({ ...graph, edges: addEdgeUnique(graph.edges, { source: connection.source, target: connection.target, branch }) });
    },
    [graph, onChange]
  );

  const addNode = useCallback(
    (type: CampaignNodeType): void => {
      const id = `${type}-${Date.now().toString(36)}-${nodeCounter++}`;
      const defaults: Record<CampaignNodeType, CampaignNode['config']> = {
        trigger: { event: 'patient-created' },
        send: { templateId: '', consentScope: 'marketing' },
        delay: { duration: 'P1D' },
        condition: { check: 'email-opened' },
        action: { op: 'add-tag' },
        exit: {},
      };
      onChange({
        ...graph,
        nodes: [...graph.nodes, { id, type, position: { x: 320, y: 80 + (graph.nodes.length % 5) * 90 }, config: defaults[type] }],
      });
      onSelectNode(id);
    },
    [graph, onChange, onSelectNode]
  );

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {!readOnly && (
        <Group gap="xs">
          {(Object.keys(NODE_META) as CampaignNodeType[])
            .filter((t) => t !== 'trigger')
            .map((type) => (
              <Button key={type} size="compact-xs" variant="light" color={NODE_META[type].color} onClick={() => addNode(type)}>
                + {NODE_META[type].label}
              </Button>
            ))}
        </Group>
      )}
      <div style={{ flex: 1, minHeight: 0, border: '1px solid var(--mantine-color-default-border)', borderRadius: 8 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={readOnly ? undefined : handleNodesChange}
          onEdgesChange={readOnly ? undefined : handleEdgesChange}
          onConnect={readOnly ? undefined : handleConnect}
          onNodeClick={(_, node) => onSelectNode(node.id)}
          onPaneClick={() => onSelectNode(undefined)}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
      {selectedNodeId === undefined && (
        <Text size="xs" c="dimmed">
          Click a node to edit it. Drag from a node's edge to connect. Condition branches connect yes first, then no.
        </Text>
      )}
    </div>
  );
}

function addEdgeUnique(edges: CampaignEdge[], edge: CampaignEdge): CampaignEdge[] {
  if (edges.some((e) => e.source === edge.source && e.target === edge.target && e.branch === edge.branch)) {
    return edges;
  }
  return [...edges, edge];
}

// Re-export for consumers that need raw React Flow helpers.
export { addEdge, applyEdgeChanges, applyNodeChanges };
