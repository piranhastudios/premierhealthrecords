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
import { requestPasswordReset } from '../../src/medplum/auth';
import { cardShadow, colors, heroGradient } from '../../src/theme/tokens';

export default function ForgotPassword(): JSX.Element {
  const medplum = useMedplum();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState(false);

  const canSubmit = email.trim().length > 3 && !busy;

  async function onSubmit(): Promise<void> {
    if (!canSubmit) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await requestPasswordReset(medplum, email);
      setSent(true);
    } catch {
      // Anti-enumeration: never reveal whether the email exists. Any failure
      // here is a network/server problem, not "no such account".
      setError('We could not send the reset email. Please check your connection and try again.');
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
            <View className="items-center gap-2">
              <Text className="text-white text-3xl font-extrabold">Reset your password</Text>
              <Text className="text-white/85 text-base text-center">
                Enter your account email and we&apos;ll send you a link to set a new password.
              </Text>
            </View>

            {sent ? (
              <View className="bg-white rounded-3xl p-5 gap-4" style={cardShadow}>
                <Text className="text-ink text-lg font-bold">Check your email</Text>
                <Text className="text-ink-secondary text-base">
                  If an account exists for{' '}
                  <Text className="text-ink font-semibold">{email.trim().toLowerCase()}</Text>, we&apos;ve sent a link to
                  reset your password. Open it, choose a new password, then come back and sign in.
                </Text>
                <Text className="text-ink-faint text-sm">
                  Didn&apos;t get it? Check your spam folder, or try again in a moment.
                </Text>
                <Pressable
                  onPress={() => setSent(false)}
                  className="h-12 bg-surface-muted rounded-pill items-center justify-center"
                >
                  <Text className="text-ink text-base font-bold">Use a different email</Text>
                </Pressable>
              </View>
            ) : (
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
                    returnKeyType="go"
                    onSubmitEditing={onSubmit}
                  />
                </View>

                {error ? <Text className="text-status-error text-sm">{error}</Text> : null}

                <Pressable
                  onPress={onSubmit}
                  disabled={!canSubmit}
                  className={`h-12 bg-phc-orange rounded-pill items-center justify-center ${
                    canSubmit ? '' : 'opacity-50'
                  }`}
                >
                  {busy ? (
                    <ActivityIndicator color={colors.white} />
                  ) : (
                    <Text className="text-white text-base font-bold">Send reset link</Text>
                  )}
                </Pressable>
              </View>
            )}

            <View className="items-center">
              <Link href="/(auth)/sign-in" asChild>
                <Pressable className="py-1">
                  <Text className="text-white text-base font-bold underline">Back to sign in</Text>
                </Pressable>
              </Link>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}
