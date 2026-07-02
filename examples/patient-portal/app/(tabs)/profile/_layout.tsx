import { Stack } from 'expo-router';
import { colors } from '../../../src/theme/tokens';

export default function ProfileLayout(): JSX.Element {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.orange,
        headerShadowVisible: false,
        headerTitleStyle: { color: colors.ink },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Profile', headerShown: false }} />
      <Stack.Screen name="id-card" options={{ title: 'Health ID' }} />
      <Stack.Screen name="family" options={{ title: 'Family' }} />
      <Stack.Screen name="records" options={{ title: 'Medical summary' }} />
      <Stack.Screen name="invoices" options={{ title: 'Payments' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
    </Stack>
  );
}
