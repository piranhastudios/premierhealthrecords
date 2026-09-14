import { useMedplum } from '@medplum/react-hooks';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActivityIndicator, Text, View } from 'react-native';
import { config } from '../src/lib/config';
import { reportError } from '../src/lib/reporting';
import { heroGradient } from '../src/theme/tokens';

// Remembers which server the cached session belongs to, so we can detect a switch.
const LAST_BASE_URL_KEY = 'phc.lastBaseUrl';

export default function Index(): JSX.Element {
  const medplum = useMedplum();
  const insets = useSafeAreaInsets();
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    (async () => {
      let hasSession = false;
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

        // getInitPromise() only waits for STORAGE. MedplumClient then kicks off
        // attemptResumeActiveLogin() without awaiting it, and that call does a
        // network round-trip to fetch the profile. Reading getProfile() here
        // would therefore race it and almost always lose — which is why a
        // returning user was being bounced to the sign-in screen despite having
        // a perfectly good stored session. getProfileAsync() joins that in-flight
        // request instead of starting a second one.
        if (medplum.getActiveLogin()) {
          hasSession = Boolean(await medplum.getProfileAsync());
        }
      } catch (err) {
        // A failed resume (expired refresh token, server down) legitimately means
        // "sign in again", so don't block launch — but do report it, because a
        // silent logout loop is otherwise invisible.
        reportError(err, { source: 'launch-resume' });
      }

      setSignedIn(hasSession);
      setReady(true);
    })();
  }, [medplum]);

  // The biometric / passcode gate lives above the router in app/_layout.tsx
  // (src/components/AppLockGate.tsx), so it covers every route and every return
  // from the background, not just this screen.
  if (!ready) {
    return (
      <LinearGradient
        colors={heroGradient.colors as readonly [string, string, ...string[]]}
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
        className="flex-1 items-center justify-center"
      >
        <Text className="text-white text-3xl font-extrabold mb-3">Premier Health</Text>
        <ActivityIndicator color="white" />
        <View className="h-8" />
      </LinearGradient>
    );
  }

  return <Redirect href={signedIn ? '/(tabs)' : '/(auth)/sign-in'} />;
}
