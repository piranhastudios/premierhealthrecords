/** What a scanned QR authorizes. */
export type QrIntent = 'id' | 'checkin' | 'pay' | 'grant';

/** High-impact intents that must NEVER be honoured offline. */
export const ONLINE_ONLY_INTENTS: ReadonlySet<QrIntent> = new Set<QrIntent>(['pay', 'grant']);

export interface QrIntentMeta {
  intent: QrIntent;
  label: string;
  description: string;
  onlineOnly: boolean;
}

export const QR_INTENTS: Record<QrIntent, QrIntentMeta> = {
  id: {
    intent: 'id',
    label: 'Identify',
    description: 'Show this at the front desk to confirm who you are.',
    onlineOnly: false,
  },
  checkin: {
    intent: 'checkin',
    label: 'Check in',
    description: 'Check in for your appointment on arrival.',
    onlineOnly: false,
  },
  pay: {
    intent: 'pay',
    label: 'Authorize payment',
    description: 'Attach a payment to your visit. Requires internet.',
    onlineOnly: true,
  },
  grant: {
    intent: 'grant',
    label: 'Share record',
    description: 'Give a provider time-boxed access to your summary. Requires internet.',
    onlineOnly: true,
  },
};

/** Modes the QR can be rendered in. */
export type QrMode = 'jws' | 'totp';

export interface QrPayload {
  /** The string encoded into the QR (a phc:// deep link — never raw PHI). */
  value: string;
  mode: QrMode;
  /** When this payload should be rotated out (epoch ms). */
  expiresAt: number;
}

/** Per-patient enrollment material for the offline path. */
export interface QrEnrollment {
  /** Opaque server handle for the patient — NOT the CNI. */
  handle: string;
  /** Base64 shared secret for offline TOTP (id/checkin only). */
  secret: string;
}
