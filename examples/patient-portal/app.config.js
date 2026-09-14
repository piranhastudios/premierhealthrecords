// Premier Health Cameroon (PHC) patient portal — Expo config.
//
// Plain JS (not app.config.ts) on purpose: EAS CLI transpiles a TS config through
// a path that breaks on some Node versions ("Cannot read properties of undefined
// (reading 'CommonJS')"). A JS config needs no transpilation and loads on any Node.
//
// Env (read at build time, surfaced via `extra` -> expo-constants):
//   MEDPLUM_BASE_URL   FHIR/Medplum server base URL. The Medplum server is reachable
//                      ONLY at https://phr.commerce.storefactory.shop/api/ — Traefik on
//                      sf-prod-1 routes that host + PathPrefix(/api) to phr-server. Live
//                      and test share it and are separated by MEDPLUM_PROJECT_ID.
//   MEDPLUM_CLIENT_ID  Optional public PKCE client id (NO secret ever ships on device)
//   MEDPLUM_PROJECT_ID Medplum project patients sign in / register into (the FHIR R4 project)
//   PHC_SENTRY_DSN     Optional crash-reporting DSN. Absent = reporting is off and the
//                      app behaves exactly as before (see src/lib/reporting.ts).
//                      Deliberately NOT called SENTRY_DSN: EAS Build sets its own
//                      SENTRY_DSN during the READ_APP_CONFIG phase (Expo's CLI
//                      telemetry DSN), which would silently bake Expo's DSN into
//                      the app and send patient crash reports to Expo's org.
//   SENTRY_ORG /       Optional, build-machine only. Set together with a SENTRY_AUTH_TOKEN
//   SENTRY_PROJECT     secret to upload source maps so stack traces are readable.

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
    associatedDomains: ['applinks:phr.commerce.storefactory.shop'],
    infoPlist: {
      NSFaceIDUsageDescription:
        'Premier Health uses Face ID to protect your health ID card and digital records.',
      NSCameraUsageDescription: 'Premier Health uses the camera to scan check-in and provider codes.',
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'cm.premierhealth.portal',
    // Explicit because it drives every layout decision in the app: from SDK 54
    // the config type only accepts `true`, so the app always draws under the
    // status and navigation bars and every screen must handle safe-area insets
    // itself. See src/components/ui/Screen.tsx for which edges to use where.
    edgeToEdgeEnabled: true,
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
        data: [{ scheme: 'https', host: 'phr.commerce.storefactory.shop', pathPrefix: '/setpassword' }],
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
    // Sentry's native (Java/Kotlin + C++) crash handlers, so a crash that never
    // reaches JS — the "closes instantly on launch" kind — is still reported.
    //
    // Only added when a DSN exists. Without one nothing would be reported
    // anyway, and the plugin registers a Gradle task that shells out to
    // sentry-cli: with no org configured that task fails, taking the whole
    // Android build down with "An organization ID or slug is required".
    // See also SENTRY_DISABLE_AUTO_UPLOAD in eas.json.
    ...(process.env.PHC_SENTRY_DSN
      ? [
          [
            '@sentry/react-native/expo',
            {
              organization: process.env.SENTRY_ORG,
              project: process.env.SENTRY_PROJECT,
            },
          ],
        ]
      : []),
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
    medplumBaseUrl: process.env.MEDPLUM_BASE_URL ?? 'https://phr.commerce.storefactory.shop/api/',
    medplumClientId: process.env.MEDPLUM_CLIENT_ID ?? '',
    medplumProjectId: process.env.MEDPLUM_PROJECT_ID ?? '161452d9-43b7-5c29-aa7b-c85680fa45c6',
    phcFhirBase: 'https://premierhealth.cm/fhir',
    sentryDsn: process.env.PHC_SENTRY_DSN ?? '',
    router: {},
    eas: { projectId: '32904d99-92a8-4afd-b199-340c7c8fcfe9' },
  },
});
