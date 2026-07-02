import { Stack } from 'expo-router';
import { colors } from '../../../src/theme/tokens';

export default function AppointmentsLayout(): JSX.Element {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.orange,
        headerShadowVisible: false,
        headerTitleStyle: { color: colors.ink },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Appointments', headerShown: false }} />
      <Stack.Screen name="search" options={{ title: 'Find a doctor' }} />
      <Stack.Screen name="[id]" options={{ title: 'Appointment' }} />
      <Stack.Screen name="doctor/[doctorId]" options={{ title: 'Doctor' }} />
    </Stack>
  );
}
