// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  List,
  Loader,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import type { WithId } from '@medplum/core';
import { normalizeErrorString } from '@medplum/core';
import { useMedplum } from '@medplum/react-hooks';
import type { Basic } from '@medplum/fhirtypes';
import type { JSX } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { searchTemplates } from '../fhir/template';
import { evaluateCondition, firstNodeId, getNode, nextNodeId } from '../graph/execute';
import type { CampaignGraph, CampaignNode } from '../graph/types';
import { CampaignCanvas, NODE_META } from './CampaignCanvas';
import { NodeInspector } from './NodeInspector';
import { useCampaign } from './useCampaign';

export interface CampaignBuilderProps {
  campaignId: string;
  /** Called after activation (e.g. to show a notification). */
  onActivated?: () => void;
}

/**
 * The full campaign builder: toolbar (status, validation, dry run, activate),
 * React Flow canvas, and the node/settings inspector. Working-graph edits
 * autosave; activation snapshots the graph + referenced templates.
 *
 * @param props - The campaign id and optional activation callback.
 * @returns The builder.
 */
export function CampaignBuilder(props: CampaignBuilderProps): JSX.Element {
  const { campaignId, onActivated } = props;
  const medplum = useMedplum();
  const { campaign, graph, updateGraph, errors, saving, activate, retire } = useCampaign(campaignId);
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [templates, setTemplates] = useState<WithId<Basic>[]>([]);
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string>();
  const [dryRunOpen, dryRunHandlers] = useDisclosure(false);

  useEffect(() => {
    searchTemplates(medplum).then(setTemplates).catch(console.error);
  }, [medplum]);

  const selectedNode = useMemo(
    () => (graph && selectedNodeId ? graph.nodes.find((n) => n.id === selectedNodeId) : undefined),
    [graph, selectedNodeId]
  );

  if (!campaign || !graph) {
    return <Loader />;
  }

  const handleNodeChange = (node: CampaignNode): void => {
    updateGraph({ ...graph, nodes: graph.nodes.map((n) => (n.id === node.id ? node : n)) });
  };

  const handleActivate = async (): Promise<void> => {
    setActivating(true);
    setActivateError(undefined);
    try {
      await activate();
      onActivated?.();
    } catch (err) {
      setActivateError(normalizeErrorString(err));
    } finally {
      setActivating(false);
    }
  };

  const statusColors: Record<string, string> = { active: 'green', retired: 'gray', draft: 'yellow' };
  const statusColor = statusColors[campaign.status] ?? 'yellow';

  return (
    <Stack gap="sm" style={{ height: '100%' }}>
      <Group justify="space-between" wrap="nowrap">
        <Group gap="sm">
          <Title order={4}>{campaign.title ?? campaign.name}</Title>
          <Badge color={statusColor} variant="light">
            {campaign.status}
          </Badge>
          <Text size="xs" c="dimmed">
            v{campaign.version ?? '0'}
            {saving ? ' · saving…' : ''}
          </Text>
        </Group>
        <Group gap="xs">
          <Button variant="default" size="xs" onClick={dryRunHandlers.open}>
            Dry run
          </Button>
          {campaign.status === 'active' && (
            <Button variant="light" color="gray" size="xs" onClick={() => retire().catch(console.error)}>
              Retire
            </Button>
          )}
          <Button size="xs" onClick={handleActivate} loading={activating} disabled={errors.length > 0}>
            {campaign.status === 'active' ? 'Re-activate (new version)' : 'Activate'}
          </Button>
        </Group>
      </Group>

      {errors.length > 0 && (
        <Alert color="yellow" title={`${errors.length} issue${errors.length === 1 ? '' : 's'} before activation`}>
          <List size="xs">
            {errors.slice(0, 5).map((e, i) => (
              <List.Item key={i}>
                {e.nodeId ? `${e.nodeId}: ` : ''}
                {e.message}
              </List.Item>
            ))}
          </List>
        </Alert>
      )}
      {activateError && (
        <Alert color="red" withCloseButton onClose={() => setActivateError(undefined)}>
          {activateError}
        </Alert>
      )}

      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <CampaignCanvas
            graph={graph}
            onChange={updateGraph}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            errorNodeIds={errors.map((e) => e.nodeId).filter((id): id is string => Boolean(id))}
          />
        </div>
        <Card withBorder w={320} style={{ overflowY: 'auto' }}>
          {selectedNode ? (
            <NodeInspector
              graph={graph}
              node={selectedNode}
              onChange={handleNodeChange}
              templates={templates}
            />
          ) : (
            <CampaignSettings graph={graph} onChange={updateGraph} />
          )}
        </Card>
      </div>

      <Modal opened={dryRunOpen} onClose={dryRunHandlers.close} title="Dry run" size="lg">
        <DryRunTrace graph={graph} />
      </Modal>
    </Stack>
  );
}

function CampaignSettings(props: { graph: CampaignGraph; onChange: (graph: CampaignGraph) => void }): JSX.Element {
  const { graph, onChange } = props;
  const settings = graph.settings;
  const set = (patch: Partial<CampaignGraph['settings']>): void => onChange({ ...graph, settings: { ...settings, ...patch } });
  return (
    <Stack gap="sm">
      <Title order={5}>Campaign settings</Title>
      <TextInput
        label="Timezone"
        description="IANA name for quiet hours (default Africa/Douala)"
        value={settings.timezone ?? ''}
        placeholder="Africa/Douala"
        onChange={(e) => set({ timezone: e.currentTarget.value || undefined })}
      />
      <Group grow>
        <TextInput
          label="Quiet hours start"
          placeholder="20:00"
          value={settings.quietHours?.start ?? ''}
          onChange={(e) => {
            const start = e.currentTarget.value;
            set({ quietHours: start ? { start, end: settings.quietHours?.end ?? '08:00' } : undefined });
          }}
        />
        <TextInput
          label="Quiet hours end"
          placeholder="08:00"
          value={settings.quietHours?.end ?? ''}
          onChange={(e) => {
            const end = e.currentTarget.value;
            set({ quietHours: end ? { start: settings.quietHours?.start ?? '20:00', end } : undefined });
          }}
        />
      </Group>
      <Select
        label="Re-enrolment"
        description="Whether patients can go through this campaign more than once (v1: enrolments never repeat)"
        data={[{ value: 'never', label: 'Never' }]}
        value={settings.reEnrolment ?? 'never'}
        onChange={() => set({ reEnrolment: 'never' })}
      />
      <Text size="xs" c="dimmed">
        Select a node on the canvas to edit its configuration.
      </Text>
    </Stack>
  );
}

/**
 * Walks the graph from the trigger, showing the path an enrolment would take.
 * Conditions default to their no branch (toggle per node in a later iteration).
 * @param props - Trace inputs.
 * @param props.graph - The campaign graph to walk.
 * @returns The trace list.
 */
function DryRunTrace(props: { graph: CampaignGraph }): JSX.Element {
  const { graph } = props;
  const steps: { node: CampaignNode; note?: string }[] = [];
  let current = firstNodeId(graph);
  const guard = new Set<string>();
  while (current && !guard.has(current) && steps.length < 30) {
    guard.add(current);
    const node = getNode(graph, current);
    if (!node) {
      break;
    }
    if (node.type === 'condition') {
      const branch = evaluateCondition(node, {
        openedSendNodes: new Set(),
        clickedSendNodes: new Set(),
        fhirSearchMatched: false,
        splitKey: 'dry-run',
      });
      steps.push({ node, note: `→ ${branch} branch (dry run assumes no engagement)` });
      current = nextNodeId(graph, node.id, branch);
    } else {
      steps.push({ node });
      current = node.type === 'exit' ? undefined : nextNodeId(graph, node.id);
    }
  }
  return (
    <Stack gap="xs">
      {steps.map((step, index) => (
        <Group key={index} gap="sm" wrap="nowrap">
          <Badge variant="filled" color={NODE_META[step.node.type].color} w={90} style={{ flexShrink: 0 }}>
            {NODE_META[step.node.type].label}
          </Badge>
          <Text size="sm">
            {step.node.id}
            {step.note ? ` ${step.note}` : ''}
          </Text>
        </Group>
      ))}
      {steps.length === 0 && <Text c="dimmed">The trigger is not connected to any node yet.</Text>}
    </Stack>
  );
}
