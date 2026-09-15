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
      <Stack.Screen name="records/index" options={{ title: 'Medical summary' }} />
      {/* Title is set per-section by the screen itself via the route param. */}
      <Stack.Screen name="records/[section]" options={{ title: 'Records' }} />
      <Stack.Screen name="invoices" options={{ title: 'Payments' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
    </Stack>
  );
}
