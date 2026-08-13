// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { ConsentScope } from '../constants';

/** Node kinds supported by the campaign engine (MVP set). */
export type CampaignNodeType = 'trigger' | 'send' | 'delay' | 'condition' | 'action' | 'exit';

/** Events a trigger node can subscribe to (enumerated — the trigger bot's registry). */
export type TriggerEvent =
  | 'patient-created'
  | 'appointment-booked'
  | 'appointment-completed'
  | 'encounter-finished'
  | 'consent-granted'
  | 'manual';

export interface TriggerConfig {
  event: TriggerEvent;
  /** Optional FHIRPath expression evaluated against the triggering resource; must be truthy to enrol. */
  fhirPathFilter?: string;
}

export interface SendConfig {
  /** Basic (email-template) id. */
  templateId: string;
  /** Overrides the template's stored subject when set. */
  subject?: string;
  /** Which consent the send requires — checked at send time. */
  consentScope: ConsentScope;
}

export interface DelayConfig {
  /** ISO 8601 duration, e.g. `P3D`, `PT2H30M`. */
  duration: string;
}

export type ConditionCheck = 'email-opened' | 'email-clicked' | 'fhir-search' | 'ab-split';

export interface ConditionConfig {
  check: ConditionCheck;
  /** For email-opened/clicked: the id of the send node being tested. */
  ref?: string;
  /** For fhir-search: criteria evaluated with `patient=` appended, truthy when >0 results. */
  search?: string;
  /** For ab-split: percentage (0-100) routed to branch `yes` (A). */
  percentA?: number;
}

export type ActionOp = 'add-tag' | 'remove-tag' | 'create-task';

export interface ActionConfig {
  op: ActionOp;
  /** For add-tag / remove-tag: the tag code (system PATIENT_TAG_SYSTEM). */
  tag?: string;
  /** For create-task: description of the staff task to raise. */
  taskDescription?: string;
}

export interface ExitConfig {
  reason?: string;
}

export type CampaignNodeConfig =
  | TriggerConfig
  | SendConfig
  | DelayConfig
  | ConditionConfig
  | ActionConfig
  | ExitConfig;

export interface CampaignNode {
  id: string;
  type: CampaignNodeType;
  /** Canvas position — irrelevant to execution, preserved for the builder. */
  position?: { x: number; y: number };
  config: CampaignNodeConfig;
}

/** Branch labels: condition nodes use yes/no; ab-split reuses yes (A) / no (B). */
export type EdgeBranch = 'yes' | 'no';

export interface CampaignEdge {
  source: string;
  target: string;
  /** Required on edges leaving a condition node. */
  branch?: EdgeBranch;
}

export interface CampaignSettings {
  /** IANA timezone for quiet hours; defaults to Africa/Douala. */
  timezone?: string;
  /** Local-time window during which sends are deferred, e.g. { start: '20:00', end: '08:00' }. */
  quietHours?: { start: string; end: string };
  /** Whether a patient who exited may be enrolled again. Default 'never'. */
  reEnrolment?: 'never' | 'after-exit' | 'always';
}

export interface CampaignGraph {
  schemaVersion: 1;
  settings: CampaignSettings;
  nodes: CampaignNode[];
  edges: CampaignEdge[];
}

/** Map of templateId → frozen compiled content stored in an activation snapshot. */
export type CompiledTemplateMap = Record<string, { subject: string; html: string }>;
