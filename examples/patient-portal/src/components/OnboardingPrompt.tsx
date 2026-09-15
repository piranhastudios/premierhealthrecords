import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useActiveProfile } from '../hooks/useActiveProfile';
import { ONBOARDING_LABELS, onboardingStatus } from '../lib/onboarding';
import { colors } from '../theme/tokens';

/**
 * Nudges a patient to finish their basic profile.
 *
 * Deliberately a prompt and not a gate. These are medical records someone may
 * need urgently, and locking the app behind a form would be the wrong trade —
 * so this is dismissible by simply ignoring it, and every other screen keeps
 * working with an incomplete profile.
 */
export function OnboardingPrompt(): JSX.Element | null {
  const router = useRouter();
  const { holder } = useActiveProfile();
  const status = onboardingStatus(holder);

  // Nothing to nudge about before a profile has loaded, or once it is done.
  if (!holder || status.complete) {
    return null;
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push('/onboarding')}
      className="rounded-card bg-phc-orange/10 border border-phc-orange/30 p-4 active:opacity-80"
    >
      <View className="flex-row items-center">
        <View className="w-10 h-10 rounded-2xl bg-phc-orange/15 items-center justify-center mr-3">
          <Ionicons name="person-add" size={20} color={colors.orange} />
        </View>
        <View className="flex-1">
          <Text className="text-ink font-semibold">Finish setting up your record</Text>
          <Text className="text-ink-secondary text-xs mt-0.5">
            {/* Naming what is missing is far more motivating than a bare percentage. */}
            We still need your {status.missing.map((f) => ONBOARDING_LABELS[f].toLowerCase()).join(', ')}.
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.orange} />
      </View>
      <View className="flex-row gap-1 mt-3">
        {Array.from({ length: status.total }).map((_, i) => (
          <View
            key={i}
            className={`h-1.5 flex-1 rounded-pill ${i < status.done ? 'bg-phc-orange' : 'bg-phc-orange/20'}`}
          />
        ))}
      </View>
    </Pressable>
  );
}
