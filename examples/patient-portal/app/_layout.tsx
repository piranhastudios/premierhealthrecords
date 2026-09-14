import '../global.css';
import '../src/theme/cssInterop';
import { MedplumProvider } from '@medplum/react-hooks';
import { StatusBar } from 'expo-status-bar';
import { Stack, useRouter, type ErrorBoundaryProps } from 'expo-router';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorScreen } from '../src/components/ErrorScreen';
import { ActiveProfileProvider } from '../src/hooks/useActiveProfile';
import { reportError } from '../src/lib/reporting';
import { getMedplum } from '../src/medplum/client';
import { SyncProvider } from '../src/offline/SyncProvider';
import { colors } from '../src/theme/tokens';

const medplum = getMedplum();

/**
 * Expo Router renders this instead of the route tree when a descendant throws
 * during render. Without it a render-time exception is fatal: release builds
 * have no red box, so React unmounts everything and the app simply closes.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps): JSX.Element {
  // In an effect, not in render: React may render this more than once for the
  // same error (StrictMode double-render in dev), and we want one report.
  useEffect(() => {
    reportError(error, { boundary: 'root' });
  }, [error]);
  return <ErrorScreen error={error} retry={retry} />;
}

export default function RootLayout(): JSX.Element {
  const router = useRouter();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <MedplumProvider medplum={medplum} navigate={(path: string) => router.push(path as never)}>
          <ActiveProfileProvider>
            <SyncProvider>
              <StatusBar style="light" />
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="setpassword/[id]/[secret]" />
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="pay/[invoiceId]" options={{ presentation: 'modal', headerShown: false }} />
                <Stack.Screen name="visit/[appointmentId]" options={{ presentation: 'fullScreenModal' }} />
              </Stack>
            </SyncProvider>
          </ActiveProfileProvider>
        </MedplumProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
