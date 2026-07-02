import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Premier Health Cameroon (PHC) patient portal — Expo config.
 *
 * Env (read at build time, surfaced via `extra` → expo-constants):
 *   MEDPLUM_BASE_URL   FHIR/Medplum server base URL (prod: https://app.premierhealthcentres.com/api/)
 *   MEDPLUM_CLIENT_ID  Optional public PKCE client id (NO secret ever ships on device)
 *   MEDPLUM_PROJECT_ID Medplum project patients sign in / register into (the FHIR R4 project)
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Premier Health',
  slug: 'premier-health-portal',
  scheme: 'phc',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  icon: './assets/icon.png',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#EE6A1F',
  },
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'cm.premierhealth.portal',
    infoPlist: {
      NSFaceIDUsageDescription:
        'Premier Health uses Face ID to protect your health ID card and digital records.',
      NSCameraUsageDescription:
        'Premier Health uses the camera to scan check-in and provider codes.',
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'cm.premierhealth.portal',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#EE6A1F',
    },
    permissions: ['USE_BIOMETRIC', 'USE_FINGERPRINT', 'CAMERA'],
  },
  web: {
    bundler: 'metro',
    output: 'single',
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-local-authentication',
    [
      'expo-camera',
      {
        cameraPermission: 'Premier Health uses the camera to scan check-in and provider codes.',
      },
    ],
    [
      'expo-build-properties',
      {
        // SQLCipher (encrypted SQLite at rest) requires a custom native build.
        ios: { useFrameworks: 'static' },
      },
    ],
  ],
  experiments: {
    typedRoutes: false,
  },
  extra: {
    medplumBaseUrl: process.env.MEDPLUM_BASE_URL ?? 'https://app.premierhealthcentres.com/api/',
    medplumClientId: process.env.MEDPLUM_CLIENT_ID ?? '',
    medplumProjectId: process.env.MEDPLUM_PROJECT_ID ?? '161452d9-43b7-5c29-aa7b-c85680fa45c6',
    phcFhirBase: 'https://premierhealth.cm/fhir',
    router: {},
    eas: {},
  },
});
