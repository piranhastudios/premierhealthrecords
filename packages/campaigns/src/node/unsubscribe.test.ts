// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import {
  buildUnsubscribeUrl,
  signUnsubscribeToken,
  UNSUBSCRIBE_PATIENT_PARAM,
  UNSUBSCRIBE_TOKEN_PARAM,
  verifyUnsubscribeToken,
} from './unsubscribe';

const SECRET = 'test-secret-key';
const BASE = 'http://localhost:8103/webhook/abc-123';

describe('unsubscribe tokens', () => {
  test('a signed token verifies for its own patient', () => {
    const token = signUnsubscribeToken('patient-1', SECRET);
    expect(verifyUnsubscribeToken('patient-1', token, SECRET)).toBe(true);
  });

  test('a token cannot be reused for another patient', () => {
    const token = signUnsubscribeToken('patient-1', SECRET);
    expect(verifyUnsubscribeToken('patient-2', token, SECRET)).toBe(false);
  });

  test('a token from a different secret is rejected', () => {
    const token = signUnsubscribeToken('patient-1', 'other-secret');
    expect(verifyUnsubscribeToken('patient-1', token, SECRET)).toBe(false);
  });

  test('missing or malformed input is rejected, never thrown', () => {
    expect(verifyUnsubscribeToken('', '', SECRET)).toBe(false);
    expect(verifyUnsubscribeToken('patient-1', 'short', SECRET)).toBe(false);
    expect(verifyUnsubscribeToken('patient-1', 'a'.repeat(64), SECRET)).toBe(false);
  });
});

describe('buildUnsubscribeUrl', () => {
  test('produces a verifiable link', () => {
    const url = buildUnsubscribeUrl('patient-1', BASE, SECRET) as string;
    expect(url).toBeDefined();
    const parsed = new URL(url);
    expect(parsed.searchParams.get(UNSUBSCRIBE_PATIENT_PARAM)).toBe('patient-1');
    const token = parsed.searchParams.get(UNSUBSCRIBE_TOKEN_PARAM) as string;
    expect(verifyUnsubscribeToken('patient-1', token, SECRET)).toBe(true);
  });

  test('returns undefined when the project has no unsubscribe secrets', () => {
    expect(buildUnsubscribeUrl('patient-1', undefined, SECRET)).toBeUndefined();
    expect(buildUnsubscribeUrl('patient-1', BASE, undefined)).toBeUndefined();
  });
});
