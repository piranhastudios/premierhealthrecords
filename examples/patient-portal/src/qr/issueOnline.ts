import type { MedplumClient } from '@medplum/core';
import type { Parameters } from '@medplum/fhirtypes';
import { QR_TOKEN_TTL_MS } from '../lib/constants';
import type { QrIntent, QrPayload } from './types';

/**
 * Ask the server to mint a short-lived signed token (JWS) for this patient+intent.
 * The token references an opaque handle + nonce + expiry — never raw PHI. The
 * provider scanner verifies it online (and the server burns the single-use nonce).
 * Backed by the server `Patient/$issue-qr` operation.
 */
export async function issueOnlineQr(
  medplum: MedplumClient,
  patientId: string,
  intent: QrIntent,
  context?: string
): Promise<QrPayload> {
  const params: Parameters = {
    resourceType: 'Parameters',
    parameter: [
      { name: 'intent', valueString: intent },
      ...(context ? [{ name: 'context', valueString: context }] : []),
    ],
  };
  const result = (await medplum.post(medplum.fhirUrl('Patient', patientId, '$issue-qr'), params)) as Parameters;
  const jws = result.parameter?.find((p) => p.name === 'jws')?.valueString;
  const exp = result.parameter?.find((p) => p.name === 'exp')?.valueInteger;
  if (!jws) {
    throw new Error('The server did not issue a QR token.');
  }
  return {
    value: `phc://q?m=jws&j=${encodeURIComponent(jws)}`,
    mode: 'jws',
    expiresAt: exp ? exp * 1000 : Date.now() + QR_TOKEN_TTL_MS,
  };
}
