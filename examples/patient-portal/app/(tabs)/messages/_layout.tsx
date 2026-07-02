import { Stack } from 'expo-router';
import { colors } from '../../../src/theme/tokens';

export default function MessagesLayout(): JSX.Element {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.orange,
        headerShadowVisible: false,
        headerTitleStyle: { color: colors.ink },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Messages', headerShown: false }} />
      <Stack.Screen name="[threadId]" options={{ title: 'Conversation' }} />
    </Stack>
  );
}
