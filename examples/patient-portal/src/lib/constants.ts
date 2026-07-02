// PHC FHIR systems and app-wide constants.
// Mirrors examples/medplum-demo-bots/src/premierhealth/lib/constants.ts where relevant.

export const PHC_BASE = 'https://premierhealth.cm';
export const PHC_FHIR = `${PHC_BASE}/fhir`;

/** Cameroon national ID (Carte Nationale d'Identité). */
export const CNI_SYSTEM = `${PHC_FHIR}/sid/cni`;
/** PHC medical record number. */
export const MRN_SYSTEM = `${PHC_FHIR}/sid/mrn`;
/** Opaque, rotating-QR patient handle (NEVER the CNI). */
export const QR_HANDLE_SYSTEM = `${PHC_FHIR}/sid/qr-handle`;

/** Default currency for invoices (Central African CFA franc). */
export const DEFAULT_CURRENCY = 'XAF';

/** Presentment currencies a diaspora payer may be charged in. */
export const PRESENTMENT_CURRENCIES = ['XAF', 'USD', 'EUR', 'GBP'] as const;
export type PresentmentCurrency = (typeof PRESENTMENT_CURRENCIES)[number];

/** pawaPay mobile-money correspondents (Cameroon). */
export const CORRESPONDENTS = [
  { value: 'MTN_MOMO_CMR', label: 'MTN Mobile Money' },
  { value: 'ORANGE_CMR', label: 'Orange Money' },
] as const;

/** Rotating-QR config. */
export const QR_ROTATE_MS = 30_000; // re-render the QR every 30s
export const QR_TOKEN_TTL_MS = 60_000; // server JWS lifetime
export const QR_TOTP_STEP_SEC = 30; // offline TOTP window

/** Sections of the curated offline summary (IPS). */
export const SUMMARY_SECTIONS = [
  'allergy',
  'medication',
  'condition',
  'immunization',
  'lab',
  'encounter',
] as const;
export type SummarySection = (typeof SUMMARY_SECTIONS)[number];
