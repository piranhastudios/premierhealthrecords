// PHC patient portal entry point.
//
// Import order is load order, and it matters here:
//   1. startReporting — crash reporting must be live before anything else can
//      throw, so a failure during module evaluation (the "app closes instantly
//      on launch" class of bug) is still captured. No-op without a DSN.
//   2. polyfills MUST land before anything imports @medplum/core, which uses Web
//      Crypto and, in its PKCE path, sessionStorage — neither exists in Hermes.
//   3. expo-router/entry registers the root component from app/ and starts the app.
import './src/lib/startReporting';
import 'react-native-get-random-values';
import './src/lib/polyfills';
import 'expo-router/entry';
