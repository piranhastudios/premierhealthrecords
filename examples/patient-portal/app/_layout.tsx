import '../global.css';
import '../src/theme/cssInterop';
import { MedplumProvider } from '@medplum/react-hooks';
import { StatusBar } from 'expo-status-bar';
import { Stack, useRouter } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActiveProfileProvider } from '../src/hooks/useActiveProfile';
import { getMedplum } from '../src/medplum/client';
import { SyncProvider } from '../src/offline/SyncProvider';
import { colors } from '../src/theme/tokens';

const medplum = getMedplum();

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
