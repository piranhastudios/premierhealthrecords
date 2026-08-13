// Premier Health Cameroon (PHC) patient portal — Expo config.
//
// Plain JS (not app.config.ts) on purpose: EAS CLI transpiles a TS config through
// a path that breaks on some Node versions ("Cannot read properties of undefined
// (reading 'CommonJS')"). A JS config needs no transpilation and loads on any Node.
//
// Env (read at build time, surfaced via `extra` -> expo-constants):
//   MEDPLUM_BASE_URL   FHIR/Medplum server base URL (prod: https://app.premierhealthcentres.com/api/)
//   MEDPLUM_CLIENT_ID  Optional public PKCE client id (NO secret ever ships on device)
//   MEDPLUM_PROJECT_ID Medplum project patients sign in / register into (the FHIR R4 project)

/**
 * @param {{ config: import('expo/config').ExpoConfig }} ctx
 * @returns {import('expo/config').ExpoConfig}
 */
module.exports = ({ config }) => ({
  ...config,
  owner: 'jngatchu',
  name: 'Premier Health',
  slug: 'patientportalapp',
  scheme: 'phc',
  version: '0.1.0',
  // EAS Update (OTA JS updates). runtimeVersion ties an update to a compatible
  // native build; 'appVersion' means updates target the same `version` above.
  updates: {
    url: 'https://u.expo.dev/32904d99-92a8-4afd-b199-340c7c8fcfe9',
  },
  runtimeVersion: {
    policy: 'appVersion',
  },
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
    // Universal Links: lets the password-reset email link (/setpassword/:id/:secret)
    // open the app. Requires the server to host /.well-known/apple-app-site-association.
    associatedDomains: ['applinks:app.premierhealthcentres.com'],
    infoPlist: {
      NSFaceIDUsageDescription:
        'Premier Health uses Face ID to protect your health ID card and digital records.',
      NSCameraUsageDescription: 'Premier Health uses the camera to scan check-in and provider codes.',
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
    // App Links: open the /setpassword reset link in the app. Requires the server
    // to host /.well-known/assetlinks.json with this package's signing fingerprint.
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'https', host: 'app.premierhealthcentres.com', pathPrefix: '/setpassword' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
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
    eas: { projectId: '32904d99-92a8-4afd-b199-340c7c8fcfe9' },
  },
});
