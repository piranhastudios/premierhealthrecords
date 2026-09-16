import { Stack } from 'expo-router';
import { colors } from '../../../src/theme/tokens';

export default function RecordsLayout(): JSX.Element {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.orange,
        headerShadowVisible: false,
        headerTitleStyle: { color: colors.ink },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Medical summary' }} />
      <Stack.Screen name="[section]" options={{ title: 'Records' }} />
    </Stack>
  );
}
