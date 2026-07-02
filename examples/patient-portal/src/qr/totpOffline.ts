import { QR_TOTP_STEP_SEC } from '../lib/constants';
import { base64ToBytes, utf8ToBytes } from '../lib/encoding';
import { totp } from './crypto';
import type { QrEnrollment, QrIntent, QrPayload } from './types';

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Degraded offline path — ONLY for low-risk intents (id / checkin). Generates a
 * rotating RFC-6238 code from the per-patient secret, with the intent mixed in so
 * an "identify" code can't be replayed as a "check-in". The facility scanner that
 * holds the same enrollment material verifies it locally and reconciles on
 * reconnect (single-use per time-step).
 */
export async function offlineQr(enrollment: QrEnrollment, intent: QrIntent): Promise<QrPayload> {
  const step = Math.floor(Date.now() / 1000 / QR_TOTP_STEP_SEC);
  const secret = concat(base64ToBytes(enrollment.secret), utf8ToBytes(`:${intent}`));
  const code = await totp(secret, step);
  return {
    value: `phc://q?m=totp&h=${encodeURIComponent(enrollment.handle)}&i=${intent}&t=${step}&c=${code}`,
    mode: 'totp',
    expiresAt: (step + 1) * QR_TOTP_STEP_SEC * 1000,
  };
}
