// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { deriveOfflineSecret, matchOfflineCodeSteps, totp } from './qr';

// DB-free unit tests for the offline TOTP step-matching helper (see the qr.ts offline path).
// The security property under test: only SERVER-derived steps (current ±1) are accepted, so a
// captured 30s code is not redeemable outside its real window no matter what step the client claims.
describe('matchOfflineCodeSteps', () => {
  const secret = Buffer.concat([
    Buffer.from(deriveOfflineSecret('test-signing-key', 'patient-123'), 'base64'),
    Buffer.from(':checkin', 'utf8'),
  ]);
  const serverStep = 59_876_543; // arbitrary but realistic step (~2026)

  test('accepts a code for the current server step', () => {
    const code = totp(secret, serverStep);
    expect(matchOfflineCodeSteps(secret, code, serverStep)).toStrictEqual([serverStep]);
  });

  test('accepts the previous and next steps (clock-skew tolerance)', () => {
    expect(matchOfflineCodeSteps(secret, totp(secret, serverStep - 1), serverStep)).toStrictEqual([serverStep - 1]);
    expect(matchOfflineCodeSteps(secret, totp(secret, serverStep + 1), serverStep)).toStrictEqual([serverStep + 1]);
  });

  test('rejects codes outside the ±1 window regardless of any client-claimed step', () => {
    // A captured code from an older window must NOT be redeemable at the current server step.
    for (const staleStep of [serverStep - 2, serverStep - 100, serverStep + 2]) {
      expect(matchOfflineCodeSteps(secret, totp(secret, staleStep), serverStep)).toStrictEqual([]);
    }
  });

  test('rejects wrong codes and wrong-length codes', () => {
    expect(matchOfflineCodeSteps(secret, '00000000', serverStep)).toStrictEqual([]);
    expect(matchOfflineCodeSteps(secret, totp(secret, serverStep).slice(0, 6), serverStep)).toStrictEqual([]);
    expect(matchOfflineCodeSteps(secret, '', serverStep)).toStrictEqual([]);
  });

  test('rejects a valid code when the intent (and thus the secret) differs', () => {
    const idSecret = Buffer.concat([
      Buffer.from(deriveOfflineSecret('test-signing-key', 'patient-123'), 'base64'),
      Buffer.from(':id', 'utf8'),
    ]);
    const checkinCode = totp(secret, serverStep);
    expect(matchOfflineCodeSteps(idSecret, checkinCode, serverStep)).toStrictEqual([]);
  });

  test('respects a custom digit count', () => {
    const code6 = totp(secret, serverStep, 6);
    expect(matchOfflineCodeSteps(secret, code6, serverStep, 6)).toStrictEqual([serverStep]);
    expect(matchOfflineCodeSteps(secret, code6, serverStep)).toStrictEqual([]); // default is 8 digits
  });
});
