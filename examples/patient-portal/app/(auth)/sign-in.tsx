import { useMedplum } from '@medplum/react-hooks';
import { LinearGradient } from 'expo-linear-gradient';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PasswordInput } from '../../src/components/PasswordInput';
import { signIn } from '../../src/medplum/auth';
import { config } from '../../src/lib/config';
import { cardShadow, colors, heroGradient } from '../../src/theme/tokens';

export default function SignIn(): JSX.Element {
  const medplum = useMedplum();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const canSubmit = email.trim().length > 3 && password.length > 0 && !busy;

  async function onSignIn(): Promise<void> {
    if (!canSubmit) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await signIn(medplum, { email, password });
      router.replace('/(tabs)');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Please check your details and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <LinearGradient
      colors={heroGradient.colors as readonly [string, string, ...string[]]}
      start={heroGradient.start}
      end={heroGradient.end}
      style={{ flex: 1 }}
    >
      <SafeAreaView className="flex-1" edges={['top', 'bottom']}>
        <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            className="flex-1"
            contentContainerClassName="grow justify-center px-6 py-10 gap-8"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View className="items-center gap-3">
              <View className="w-20 h-20 rounded-3xl bg-white/20 items-center justify-center">
                <Text className="text-white text-5xl font-black">P</Text>
              </View>
              <Text className="text-white text-3xl font-extrabold">Premier Health</Text>
              <Text className="text-white/85 text-base text-center">
                Your family&apos;s health, in your pocket — wherever you are.
              </Text>
            </View>

            <View className="bg-white rounded-3xl p-5 gap-4" style={cardShadow}>
              <View className="gap-1.5">
                <Text className="text-ink-secondary text-sm font-semibold">Email</Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="name@example.com"
                  placeholderTextColor={colors.inkFaint}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  className="bg-surface-muted rounded-field px-4 h-12 text-ink text-base"
                />
              </View>

              <View className="gap-1.5">
                <Text className="text-ink-secondary text-sm font-semibold">Password</Text>
                <PasswordInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Your password"
                  autoComplete="current-password"
                  returnKeyType="go"
                  onSubmitEditing={onSignIn}
                />
              </View>

              <Link href="/(auth)/forgot-password" asChild>
                <Pressable className="self-end py-0.5">
                  <Text className="text-phc-orange text-sm font-semibold">Forgot password?</Text>
                </Pressable>
              </Link>

              {error ? <Text className="text-status-error text-sm">{error}</Text> : null}

              <Pressable
                onPress={onSignIn}
                disabled={!canSubmit}
                className={`h-12 bg-phc-orange rounded-pill items-center justify-center ${
                  canSubmit ? '' : 'opacity-50'
                }`}
              >
                {busy ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text className="text-white text-base font-bold">Sign in</Text>
                )}
              </Pressable>
            </View>

            <View className="items-center gap-1">
              <Text className="text-white/90 text-sm">New to Premier Health?</Text>
              <Link href="/(auth)/register" asChild>
                <Pressable className="py-1">
                  <Text className="text-white text-base font-bold underline">Create an account</Text>
                </Pressable>
              </Link>
            </View>

            <Text className="text-white/70 text-xs text-center">
              By continuing you agree to Premier Health&apos;s Terms &amp; Privacy Policy.
            </Text>

            {__DEV__ ? (
              <Text className="text-white/60 text-xs text-center">
                dev · connected to {config.medplumBaseUrl}
              </Text>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}
