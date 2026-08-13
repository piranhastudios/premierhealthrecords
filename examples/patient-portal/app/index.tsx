import { useMedplum } from '@medplum/react-hooks';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { config } from '../src/lib/config';
import { heroGradient } from '../src/theme/tokens';

// Remembers which server the cached session belongs to, so we can detect a switch.
const LAST_BASE_URL_KEY = 'phc.lastBaseUrl';

export default function Index(): JSX.Element {
  const medplum = useMedplum();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        await medplum.getInitPromise();
        // If the configured server changed since last launch (e.g. prod -> local
        // dev), the persisted session belongs to the other server. Sign out so the
        // user re-authenticates against the current server instead of silently
        // showing stale, cross-server cached data. In dev we also drop a session
        // whose server we can't confirm (no marker yet — e.g. the first launch
        // after pointing the app at a local server), so testing always starts
        // against the configured server. This never fires in production (the
        // server never changes there, so the marker always matches).
        const last = await SecureStore.getItemAsync(LAST_BASE_URL_KEY);
        const serverChanged = Boolean(last) && last !== config.medplumBaseUrl;
        const unconfirmedInDev = __DEV__ && !last;
        if (medplum.getActiveLogin() && (serverChanged || unconfirmedInDev)) {
          await medplum.signOut();
        }
        await SecureStore.setItemAsync(LAST_BASE_URL_KEY, config.medplumBaseUrl);
      } catch {
        // best effort — never block app launch on this
      } finally {
        setReady(true);
      }
    })();
  }, [medplum]);

  if (!ready) {
    return (
      <LinearGradient
        colors={heroGradient.colors as readonly [string, string, ...string[]]}
        className="flex-1 items-center justify-center"
      >
        <Text className="text-white text-3xl font-extrabold mb-3">Premier Health</Text>
        <ActivityIndicator color="white" />
        <View className="h-8" />
      </LinearGradient>
    );
  }

  return <Redirect href={medplum.getProfile() ? '/(tabs)' : '/(auth)/sign-in'} />;
}
