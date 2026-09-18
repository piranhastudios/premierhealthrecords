import Constants from 'expo-constants';

/** Build-time config surfaced from app.config.ts → expo-constants. */
export interface PhcConfig {
  /** Medplum/FHIR server base URL, always trailing-slashed. */
  medplumBaseUrl: string;
  /** Optional public PKCE OAuth client id (no secret ever ships on device). */
  medplumClientId: string;
  /** Medplum project patients sign in / register into (the FHIR R4 project). */
  medplumProjectId: string;
  /** PHC FHIR identifier namespace. */
  phcFhirBase: string;
  /** Public PostHog project token baked in by Expo at build time. */
  posthogProjectToken: string;
  /** PostHog ingestion host baked in by Expo at build time. */
  posthogHost: string;
}

function trailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

const extra = (Constants.expoConfig?.extra ?? {}) as Partial<PhcConfig>;

export const config: PhcConfig = {
  medplumBaseUrl: trailingSlash(extra.medplumBaseUrl ?? 'https://phr.commerce.storefactory.shop/api/'),
  medplumClientId: extra.medplumClientId ?? '',
  medplumProjectId: extra.medplumProjectId ?? '',
  phcFhirBase: extra.phcFhirBase ?? 'https://premierhealth.cm/fhir',
  posthogProjectToken: extra.posthogProjectToken ?? '',
  posthogHost: extra.posthogHost ?? '',
};
