// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Webhook authentication helpers for the inbound bots.
 *
 * Note on raw-body HMAC: bots receive an already-parsed `event.input`, not the raw
 * request bytes, so provider HMAC schemes (Svix/Resend) that sign the raw body can't
 * be reproduced reliably here. The primary, reliable check for the generic inbound
 * email endpoint is therefore a shared secret carried in a header or query param.
 * {@link verifyHmacSha256} is provided for providers that sign a reconstructable
 * string (timestamp.payload), where raw bytes are available.
 */

import type { BotEvent } from '@medplum/core';
import { createHmac, timingSafeEqual } from 'node:crypto';

// Constant-time string comparison that tolerates length differences.
export function timingSafeEqualStr(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

function headerValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string
): string | undefined {
  if (!headers) {
    return undefined;
  }
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}

// Verify a shared secret presented by the caller. Accepts the secret in the
// `x-webhook-token` header, an `Authorization: Bearer <secret>` header, or a
// `token` field in the body. Returns false if no secret is configured.
export function verifySharedSecret(event: BotEvent<any>, expected: string | undefined): boolean {
  if (!expected) {
    return false;
  }
  const headers = event.headers;
  const fromHeader = headerValue(headers, 'x-webhook-token');
  if (fromHeader && timingSafeEqualStr(fromHeader, expected)) {
    return true;
  }
  const auth = headerValue(headers, 'authorization');
  if (auth?.startsWith('Bearer ') && timingSafeEqualStr(auth.slice(7), expected)) {
    return true;
  }
  const bodyToken = typeof event.input === 'object' && event.input ? event.input.token : undefined;
  return typeof bodyToken === 'string' && timingSafeEqualStr(bodyToken, expected);
}

// Verify an HMAC-SHA256 signature over a signed payload string. `signature` may be
// hex or base64; both encodings are compared.
export function verifyHmacSha256(signedPayload: string, signature: string, secret: string): boolean {
  const digest = createHmac('sha256', secret).update(signedPayload).digest();
  // Compare against both hex and base64 encodings to support multiple providers.
  return (
    timingSafeEqualStr(signature, digest.toString('hex')) || timingSafeEqualStr(signature, digest.toString('base64'))
  );
}
