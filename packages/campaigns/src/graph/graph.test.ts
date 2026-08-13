// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { applyQuietHours, evaluateCondition, firstNodeId, nextNodeId, parseIsoDuration, splitBucket } from './execute';
import type { CampaignGraph, CampaignNode } from './types';
import { validateGraph } from './validate';

function welcomeGraph(): CampaignGraph {
  return {
    schemaVersion: 1,
    settings: {},
    nodes: [
      { id: 't', type: 'trigger', config: { event: 'patient-created' } },
      { id: 's1', type: 'send', config: { templateId: 'tmpl-1', consentScope: 'marketing' } },
      { id: 'd1', type: 'delay', config: { duration: 'P3D' } },
      { id: 'c1', type: 'condition', config: { check: 'email-opened', ref: 's1' } },
      { id: 's2', type: 'send', config: { templateId: 'tmpl-2', consentScope: 'marketing' } },
      { id: 'x1', type: 'exit', config: {} },
      { id: 'x2', type: 'exit', config: {} },
    ],
    edges: [
      { source: 't', target: 's1' },
      { source: 's1', target: 'd1' },
      { source: 'd1', target: 'c1' },
      { source: 'c1', target: 'x1', branch: 'yes' },
      { source: 'c1', target: 's2', branch: 'no' },
      { source: 's2', target: 'x2' },
    ],
  };
}

describe('validateGraph', () => {
  test('valid welcome graph passes', () => {
    expect(validateGraph(welcomeGraph())).toEqual([]);
  });

  test('detects cycle', () => {
    const graph = welcomeGraph();
    graph.edges.push({ source: 's2', target: 'd1' });
    // s2 now has two outgoing edges AND creates a cycle
    const errors = validateGraph(graph);
    expect(errors.some((e) => e.message.includes('cycle'))).toBe(true);
  });

  test('condition missing a branch fails', () => {
    const graph = welcomeGraph();
    graph.edges = graph.edges.filter((e) => !(e.source === 'c1' && e.branch === 'no'));
    const errors = validateGraph(graph);
    expect(errors.some((e) => e.nodeId === 'c1')).toBe(true);
  });

  test('send without consent scope fails', () => {
    const graph = welcomeGraph();
    const send = graph.nodes.find((n) => n.id === 's1') as CampaignNode;
    send.config = { templateId: 'tmpl-1' } as never;
    const errors = validateGraph(graph);
    expect(errors.some((e) => e.nodeId === 's1' && e.message.includes('consent'))).toBe(true);
  });

  test('orphan node fails', () => {
    const graph = welcomeGraph();
    graph.nodes.push({ id: 'orphan', type: 'exit', config: {} });
    const errors = validateGraph(graph);
    expect(errors.some((e) => e.nodeId === 'orphan')).toBe(true);
  });
});

describe('execute helpers', () => {
  test('firstNodeId follows the trigger', () => {
    expect(firstNodeId(welcomeGraph())).toBe('s1');
  });

  test('nextNodeId follows branches', () => {
    const graph = welcomeGraph();
    expect(nextNodeId(graph, 'c1', 'yes')).toBe('x1');
    expect(nextNodeId(graph, 'c1', 'no')).toBe('s2');
    expect(nextNodeId(graph, 's1')).toBe('d1');
  });

  test('parseIsoDuration', () => {
    expect(parseIsoDuration('P3D')).toBe(3 * 24 * 3600_000);
    expect(parseIsoDuration('PT2H30M')).toBe(2.5 * 3600_000);
    expect(parseIsoDuration('P1W')).toBe(7 * 24 * 3600_000);
    expect(parseIsoDuration('nonsense')).toBeUndefined();
    expect(parseIsoDuration('P')).toBeUndefined();
  });

  test('applyQuietHours defers inside window (spanning midnight)', () => {
    const settings = { timezone: 'UTC', quietHours: { start: '20:00', end: '08:00' } };
    const inside = new Date('2026-08-09T22:00:00Z');
    const adjusted = applyQuietHours(inside, settings);
    expect(adjusted.toISOString()).toBe('2026-08-10T08:00:00.000Z');
    const outside = new Date('2026-08-09T12:00:00Z');
    expect(applyQuietHours(outside, settings).toISOString()).toBe(outside.toISOString());
  });

  test('splitBucket is deterministic and in range', () => {
    const a = splitBucket('task-1:n4');
    expect(a).toBe(splitBucket('task-1:n4'));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(100);
  });

  test('evaluateCondition', () => {
    const node: CampaignNode = { id: 'c1', type: 'condition', config: { check: 'email-opened', ref: 's1' } };
    const base = { openedSendNodes: new Set<string>(), clickedSendNodes: new Set<string>(), splitKey: 'k' };
    expect(evaluateCondition(node, { ...base, openedSendNodes: new Set(['s1']) })).toBe('yes');
    expect(evaluateCondition(node, base)).toBe('no');
  });
});
