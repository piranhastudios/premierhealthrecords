import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { Button, Card, Screen } from '../../src/components/ui';
import { colors } from '../../src/theme/tokens';

const STEPS = [
  {
    icon: 'videocam' as const,
    title: 'A short video call with a nurse',
    body: 'About fifteen minutes. You can do it from home — no need to travel.',
  },
  {
    icon: 'clipboard' as const,
    title: 'They record your health history',
    body: 'Allergies, medicines you take, past conditions and vaccinations. A nurse enters these so your record is accurate.',
  },
  {
    icon: 'shield-checkmark' as const,
    title: 'Your identity is confirmed',
    body: 'They check the document you gave us. Once confirmed, your health ID card can be used at any Premier Health centre.',
  },
];

/**
 * Shown straight after the basic profile is saved.
 *
 * The intro appointment is where the clinical record actually gets created: the
 * app collects demographics only, so until a nurse has taken a history there is
 * nothing for another clinician to act on. This screen exists to explain why it
 * is worth booking, rather than dropping someone back on the home screen with
 * an empty record.
 */
export default function IntroVisit(): JSX.Element {
  const router = useRouter();

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: 'Your first appointment' }} />

      <View className="items-center mt-4 mb-2">
        <View className="w-16 h-16 rounded-full bg-phc-orange/12 items-center justify-center mb-3">
          <Ionicons name="checkmark-circle" size={34} color={colors.success} />
        </View>
        <Text className="text-ink text-xl font-bold text-center">Profile saved</Text>
        <Text className="text-ink-secondary text-sm text-center mt-1">
          Next, book a short introduction appointment so a nurse can complete your health record.
        </Text>
      </View>

      {STEPS.map((step) => (
        <Card key={step.title}>
          <View className="flex-row">
            <View className="w-10 h-10 rounded-2xl bg-phc-orange/12 items-center justify-center mr-3">
              <Ionicons name={step.icon} size={20} color={colors.orange} />
            </View>
            <View className="flex-1">
              <Text className="text-ink font-semibold">{step.title}</Text>
              <Text className="text-ink-secondary text-sm mt-0.5">{step.body}</Text>
            </View>
          </View>
        </Card>
      ))}

      <Button
        label="Book my introduction"
        onPress={() => router.replace('/(tabs)/appointments/search')}
        className="mt-4"
      />
      {/* Never a dead end: the record is still usable, just thinner. */}
      <Button label="Not now" variant="ghost" onPress={() => router.replace('/(tabs)')} className="mt-2" />
    </Screen>
  );
}
