// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { DEFAULT_TIMEZONE } from '../constants';
import type { CampaignEdge, CampaignGraph, CampaignNode, CampaignSettings, ConditionConfig, EdgeBranch } from './types';

/**
 * Pure graph-walk helpers shared by the executor bot and the builder's dry-run
 * trace, so execution semantics cannot drift between the two.
 */

export function getNode(graph: CampaignGraph, id: string): CampaignNode | undefined {
  return graph.nodes.find((n) => n.id === id);
}

export function getTriggerNode(graph: CampaignGraph): CampaignNode | undefined {
  return graph.nodes.find((n) => n.type === 'trigger');
}

/**
 * Resolves the next node id following an edge out of `nodeId`.
 * @param graph - The campaign graph.
 * @param nodeId - The current node.
 * @param branch - Which branch to follow (condition nodes only).
 * @returns The next node id, or undefined at a dead end.
 */
export function nextNodeId(graph: CampaignGraph, nodeId: string, branch?: EdgeBranch): string | undefined {
  const outgoing = graph.edges.filter((e: CampaignEdge) => e.source === nodeId);
  if (branch) {
    return outgoing.find((e) => e.branch === branch)?.target;
  }
  return outgoing[0]?.target;
}

/**
 * The first executable node — the one the trigger points at.
 * @param graph - The campaign graph.
 * @returns The first node id, or undefined.
 */
export function firstNodeId(graph: CampaignGraph): string | undefined {
  const trigger = getTriggerNode(graph);
  return trigger ? nextNodeId(graph, trigger.id) : undefined;
}

/**
 * Parses an ISO 8601 duration (P[nD][T[nH][nM][nS]], plus weeks) into milliseconds.
 * @param duration - The ISO duration, e.g. `P3D`, `PT2H30M`, `P1W`.
 * @returns Milliseconds, or undefined when unparseable.
 */
export function parseIsoDuration(duration: string): number | undefined {
  const match = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(duration.trim());
  if (!match || match.slice(1).every((part) => part === undefined)) {
    return undefined;
  }
  const [, weeks, days, hours, minutes, seconds] = match.map((v) => (v ? parseInt(v, 10) : 0));
  return (((weeks * 7 + days) * 24 + hours) * 60 + minutes) * 60_000 + seconds * 1000;
}

/**
 * Local hour+minute of a Date in a timezone, as minutes since midnight.
 * @param date - The instant to convert.
 * @param timezone - IANA timezone name.
 * @returns Minutes since local midnight.
 */
function localMinutes(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

function parseHhMm(value: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return undefined;
  }
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes < 24 * 60 ? minutes : undefined;
}

/**
 * Applies the campaign's quiet-hours window: when `date` falls inside it, the
 * send is deferred to the end of the window (same or next day); otherwise the
 * date is returned unchanged. The window may span midnight (e.g. 20:00-08:00).
 *
 * @param date - The intended send time.
 * @param settings - Campaign settings (timezone + quietHours).
 * @returns The adjusted send time.
 */
export function applyQuietHours(date: Date, settings: CampaignSettings): Date {
  const window = settings.quietHours;
  if (!window) {
    return date;
  }
  const start = parseHhMm(window.start);
  const end = parseHhMm(window.end);
  if (start === undefined || end === undefined || start === end) {
    return date;
  }
  const timezone = settings.timezone ?? DEFAULT_TIMEZONE;
  const now = localMinutes(date, timezone);
  const inWindow = start < end ? now >= start && now < end : now >= start || now < end;
  if (!inWindow) {
    return date;
  }
  // Defer to the end of the window: minutes until `end` local time.
  const minutesUntilEnd = (end - now + 24 * 60) % (24 * 60) || 24 * 60;
  return new Date(date.getTime() + minutesUntilEnd * 60_000);
}

/** Inputs the executor supplies for condition evaluation. */
export interface ConditionInput {
  /** Send-node ids whose emails were opened by this patient in this enrolment. */
  openedSendNodes: ReadonlySet<string>;
  /** Send-node ids whose emails were clicked. */
  clickedSendNodes: ReadonlySet<string>;
  /** Result of the node's fhir-search criteria (executor pre-evaluates). */
  fhirSearchMatched?: boolean;
  /** Stable key for deterministic A/B assignment (e.g. the enrolment Task id). */
  splitKey: string;
}

/**
 * Deterministic 0-99 bucket from a string key (stable across retries).
 * @param key - The assignment key (enrolment id + node id).
 * @returns A bucket in [0, 100).
 */
export function splitBucket(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return hash % 100;
}

/**
 * Evaluates a condition node to a branch.
 * @param node - The condition node.
 * @param input - Evaluation inputs supplied by the executor / dry run.
 * @returns 'yes' or 'no'.
 */
export function evaluateCondition(node: CampaignNode, input: ConditionInput): EdgeBranch {
  const config = node.config as ConditionConfig;
  switch (config.check) {
    case 'email-opened':
      return config.ref && input.openedSendNodes.has(config.ref) ? 'yes' : 'no';
    case 'email-clicked':
      return config.ref && input.clickedSendNodes.has(config.ref) ? 'yes' : 'no';
    case 'fhir-search':
      return input.fhirSearchMatched ? 'yes' : 'no';
    case 'ab-split':
      return splitBucket(`${input.splitKey}:${node.id}`) < (config.percentA ?? 50) ? 'yes' : 'no';
    default:
      return 'no';
  }
}
