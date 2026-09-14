import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { heroGradient } from '../theme/tokens';

interface ErrorScreenProps {
  error: Error;
  /** Expo Router hands us a retry that re-mounts the failed route subtree. */
  retry: () => void;
}

/**
 * Last line of defence for a render-time crash. Without this, an exception in
 * any screen tears down the React tree and — in a release build, where there is
 * no red box — closes the app with no explanation.
 *
 * The message is only shown in development: in production a stack trace tells a
 * patient nothing and may carry record details, so they get a plain apology and
 * a Try again button while the real error goes to Sentry.
 */
export function ErrorScreen({ error, retry }: ErrorScreenProps): JSX.Element {
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient
      colors={heroGradient.colors as readonly [string, string, ...string[]]}
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      className="flex-1 items-center justify-center px-8"
    >
      <Text className="text-white text-2xl font-extrabold text-center mb-2">Something went wrong</Text>
      <Text className="text-white/90 text-base text-center mb-6">
        Sorry — this screen could not be opened. Your records are safe.
      </Text>

      {__DEV__ ? (
        <ScrollView className="max-h-48 self-stretch mb-6 bg-black/25 rounded-2xl p-4">
          <Text className="text-white/90 text-xs">{error.stack ?? error.message}</Text>
        </ScrollView>
      ) : null}

      <Pressable
        accessibilityRole="button"
        onPress={retry}
        className="bg-white rounded-full px-8 py-4 active:opacity-80"
      >
        <Text className="text-ink text-base font-bold">Try again</Text>
      </Pressable>
      <View className="h-8" />
    </LinearGradient>
  );
}
