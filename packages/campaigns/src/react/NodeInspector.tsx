// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Badge, NumberInput, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import type { WithId } from '@medplum/core';
import type { Basic } from '@medplum/fhirtypes';
import type { JSX } from 'react';
import type {
  ActionConfig,
  CampaignGraph,
  CampaignNode,
  ConditionConfig,
  DelayConfig,
  ExitConfig,
  SendConfig,
  TriggerConfig,
  TriggerEvent,
} from '../graph/types';
import { NODE_META } from './CampaignCanvas';

const TRIGGER_EVENTS: { value: TriggerEvent; label: string }[] = [
  { value: 'patient-created', label: 'Patient registered' },
  { value: 'appointment-booked', label: 'Appointment booked' },
  { value: 'appointment-completed', label: 'Appointment completed' },
  { value: 'encounter-finished', label: 'Visit finished' },
  { value: 'consent-granted', label: 'Consent granted' },
];

export interface NodeInspectorProps {
  graph: CampaignGraph;
  node: CampaignNode;
  onChange: (node: CampaignNode) => void;
  /** Available email templates for the send-node picker. */
  templates: WithId<Basic>[];
  readOnly?: boolean;
}

/**
 * Per-node configuration form. Each field writes straight back into the node
 * config via `onChange` (the builder handles autosave).
 *
 * @param props - The node being edited and the change callback.
 * @returns The inspector panel.
 */
export function NodeInspector(props: NodeInspectorProps): JSX.Element {
  const { graph, node, onChange, templates, readOnly } = props;
  const set = (patch: Record<string, unknown>): void =>
    onChange({ ...node, config: { ...(node.config as Record<string, unknown>), ...patch } as CampaignNode['config'] });
  const disabled = readOnly;

  return (
    <Stack gap="sm">
      <Title order={5}>
        <Badge variant="filled" color={NODE_META[node.type].color} mr={8}>
          {NODE_META[node.type].label}
        </Badge>
        {node.id}
      </Title>

      {node.type === 'trigger' && (
        <>
          <Select
            label="Event"
            data={TRIGGER_EVENTS}
            value={(node.config as TriggerConfig).event}
            onChange={(v) => v && set({ event: v })}
            disabled={disabled}
          />
          <TextInput
            label="FHIRPath filter (optional)"
            description="Evaluated against the triggering resource; must be truthy to enrol"
            value={(node.config as TriggerConfig).fhirPathFilter ?? ''}
            onChange={(e) => set({ fhirPathFilter: e.currentTarget.value || undefined })}
            disabled={disabled}
          />
        </>
      )}

      {node.type === 'send' && (
        <>
          <Select
            label="Template"
            placeholder="Select email template"
            data={templates.map((t) => ({ value: t.id, label: t.identifier?.[0]?.value ?? t.id }))}
            value={(node.config as SendConfig).templateId || null}
            onChange={(v) => v && set({ templateId: v })}
            searchable
            disabled={disabled}
          />
          <TextInput
            label="Subject override (optional)"
            value={(node.config as SendConfig).subject ?? ''}
            onChange={(e) => set({ subject: e.currentTarget.value || undefined })}
            disabled={disabled}
          />
          <Select
            label="Consent scope"
            description="Checked at send time — marketing requires explicit opt-in"
            data={[
              { value: 'marketing', label: 'Marketing (explicit opt-in)' },
              { value: 'care-communication', label: 'Care communication (transactional)' },
            ]}
            value={(node.config as SendConfig).consentScope}
            onChange={(v) => v && set({ consentScope: v })}
            disabled={disabled}
          />
        </>
      )}

      {node.type === 'delay' && (
        <TextInput
          label="Duration (ISO 8601)"
          description="e.g. P3D (3 days), PT2H (2 hours), P1W (1 week)"
          value={(node.config as DelayConfig).duration}
          onChange={(e) => set({ duration: e.currentTarget.value })}
          disabled={disabled}
        />
      )}

      {node.type === 'condition' && (
        <>
          <Select
            label="Check"
            data={[
              { value: 'email-opened', label: 'Email opened?' },
              { value: 'email-clicked', label: 'Email clicked?' },
              { value: 'fhir-search', label: 'FHIR search matches?' },
              { value: 'ab-split', label: 'A/B split' },
            ]}
            value={(node.config as ConditionConfig).check}
            onChange={(v) => v && set({ check: v })}
            disabled={disabled}
          />
          {((node.config as ConditionConfig).check === 'email-opened' ||
            (node.config as ConditionConfig).check === 'email-clicked') && (
            <Select
              label="Which send?"
              data={graph.nodes.filter((n) => n.type === 'send').map((n) => ({ value: n.id, label: n.id }))}
              value={(node.config as ConditionConfig).ref ?? null}
              onChange={(v) => v && set({ ref: v })}
              disabled={disabled}
            />
          )}
          {(node.config as ConditionConfig).check === 'fhir-search' && (
            <TextInput
              label="Search criteria"
              description="e.g. Appointment?status=booked — patient filter is added automatically"
              value={(node.config as ConditionConfig).search ?? ''}
              onChange={(e) => set({ search: e.currentTarget.value })}
              disabled={disabled}
            />
          )}
          {(node.config as ConditionConfig).check === 'ab-split' && (
            <NumberInput
              label="% to branch A (yes)"
              min={0}
              max={100}
              value={(node.config as ConditionConfig).percentA ?? 50}
              onChange={(v) => set({ percentA: typeof v === 'number' ? v : 50 })}
              disabled={disabled}
            />
          )}
        </>
      )}

      {node.type === 'action' && (
        <>
          <Select
            label="Operation"
            data={[
              { value: 'add-tag', label: 'Add patient tag' },
              { value: 'remove-tag', label: 'Remove patient tag' },
              { value: 'create-task', label: 'Create staff task' },
            ]}
            value={(node.config as ActionConfig).op}
            onChange={(v) => v && set({ op: v })}
            disabled={disabled}
          />
          {((node.config as ActionConfig).op === 'add-tag' || (node.config as ActionConfig).op === 'remove-tag') && (
            <TextInput
              label="Tag"
              value={(node.config as ActionConfig).tag ?? ''}
              onChange={(e) => set({ tag: e.currentTarget.value })}
              disabled={disabled}
            />
          )}
          {(node.config as ActionConfig).op === 'create-task' && (
            <TextInput
              label="Task description"
              value={(node.config as ActionConfig).taskDescription ?? ''}
              onChange={(e) => set({ taskDescription: e.currentTarget.value })}
              disabled={disabled}
            />
          )}
        </>
      )}

      {node.type === 'exit' && (
        <TextInput
          label="Exit reason (optional)"
          value={(node.config as ExitConfig).reason ?? ''}
          onChange={(e) => set({ reason: e.currentTarget.value || undefined })}
          disabled={disabled}
        />
      )}

      <Text size="xs" c="dimmed">
        Changes save automatically.
      </Text>
    </Stack>
  );
}
