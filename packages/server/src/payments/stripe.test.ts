// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { Project } from '@medplum/fhirtypes';
import {
  extractWebhookProjectId,
  fromStripeMinorUnits,
  resolveStripeWebhookSecret,
  toStripeMinorUnits,
} from './stripe';

describe('Stripe currency helpers', () => {
  test('XAF is zero-decimal: passed through as integers', () => {
    // A 25,000 XAF consultation must NOT become 2,500,000 minor units.
    expect(toStripeMinorUnits(25000, 'XAF')).toBe(25000);
    expect(fromStripeMinorUnits(25000, 'XAF')).toBe(25000);
  });

  test('two-decimal currencies convert to/from cents', () => {
    expect(toStripeMinorUnits(19.99, 'USD')).toBe(1999);
    expect(toStripeMinorUnits(10, 'EUR')).toBe(1000);
    expect(fromStripeMinorUnits(1999, 'USD')).toBe(19.99);
    expect(fromStripeMinorUnits(1000, 'GBP')).toBe(10);
  });

  test('currency code is case-insensitive', () => {
    expect(toStripeMinorUnits(5000, 'xaf')).toBe(5000);
    expect(toStripeMinorUnits(50, 'usd')).toBe(5000);
  });

  test('fractional zero-decimal amounts round to whole units', () => {
    expect(toStripeMinorUnits(1000.4, 'XAF')).toBe(1000);
    expect(toStripeMinorUnits(1000.5, 'XAF')).toBe(1001);
  });

  test('floating point cents round instead of truncate', () => {
    // 0.29 * 100 === 28.999999999999996 in IEEE 754.
    expect(toStripeMinorUnits(0.29, 'USD')).toBe(29);
  });

  test('round-trips are stable for both currency classes', () => {
    for (const [amount, currency] of [
      [25000, 'XAF'],
      [12.34, 'USD'],
      [99999, 'XOF'],
      [0.01, 'EUR'],
    ] as [number, string][]) {
      expect(fromStripeMinorUnits(toStripeMinorUnits(amount, currency), currency)).toBe(amount);
    }
  });
});

describe('resolveStripeWebhookSecret', () => {
  const originalEnvSecret = process.env.STRIPE_WEBHOOK_SECRET;

  afterEach(() => {
    if (originalEnvSecret === undefined) {
      delete process.env.STRIPE_WEBHOOK_SECRET;
    } else {
      process.env.STRIPE_WEBHOOK_SECRET = originalEnvSecret;
    }
  });

  const projectWithSecret: Project = {
    resourceType: 'Project',
    secret: [{ name: 'STRIPE_WEBHOOK_SECRET', valueString: 'whsec_project' }],
  };

  test('prefers the project secret over the env var', () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_env';
    expect(resolveStripeWebhookSecret(projectWithSecret)).toBe('whsec_project');
  });

  test('project-secret-only config resolves without an env var', () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect(resolveStripeWebhookSecret(projectWithSecret)).toBe('whsec_project');
  });

  test('falls back to the env var when the project has no secret', () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_env';
    expect(resolveStripeWebhookSecret({ resourceType: 'Project' })).toBe('whsec_env');
    expect(resolveStripeWebhookSecret(undefined)).toBe('whsec_env');
  });

  test('returns undefined when not configured anywhere', () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect(resolveStripeWebhookSecret({ resourceType: 'Project' })).toBeUndefined();
    expect(resolveStripeWebhookSecret(undefined)).toBeUndefined();
  });
});

describe('extractWebhookProjectId', () => {
  test('extracts the projectId metadata stamped by $checkout', () => {
    const body = Buffer.from(
      JSON.stringify({
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_123', metadata: { projectId: 'proj-1', invoiceId: 'inv-1' } } },
      })
    );
    expect(extractWebhookProjectId(body)).toBe('proj-1');
    expect(extractWebhookProjectId(body.toString('utf8'))).toBe('proj-1');
  });

  test('returns undefined for missing/empty/non-string projectId', () => {
    expect(extractWebhookProjectId(Buffer.from(JSON.stringify({ data: { object: {} } })))).toBeUndefined();
    expect(
      extractWebhookProjectId(Buffer.from(JSON.stringify({ data: { object: { metadata: { projectId: '' } } } })))
    ).toBeUndefined();
    expect(
      extractWebhookProjectId(Buffer.from(JSON.stringify({ data: { object: { metadata: { projectId: 42 } } } })))
    ).toBeUndefined();
  });

  test('returns undefined for malformed or missing bodies', () => {
    expect(extractWebhookProjectId(Buffer.from('not json'))).toBeUndefined();
    expect(extractWebhookProjectId(undefined)).toBeUndefined();
  });
});
