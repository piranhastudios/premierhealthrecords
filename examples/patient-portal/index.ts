// PHC patient portal entry point.
// Polyfills MUST load before anything imports @medplum/core (which uses Web Crypto
// and, in its PKCE path, sessionStorage — neither exists in React Native/Hermes).
import 'react-native-get-random-values';
import './src/lib/polyfills';
// Hand control to expo-router, which registers the root component from app/.
import 'expo-router/entry';
