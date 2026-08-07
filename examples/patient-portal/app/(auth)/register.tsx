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
import { register } from '../../src/medplum/auth';
import { cardShadow, colors, heroGradient } from '../../src/theme/tokens';

const inputClass = 'bg-surface-muted rounded-field px-4 h-12 text-ink text-base';

export default function Register(): JSX.Element {
  const medplum = useMedplum();
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const canSubmit =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    email.trim().length > 3 &&
    password.length >= 8 &&
    !busy;

  async function onRegister(): Promise<void> {
    if (busy) {
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await register(medplum, { firstName, lastName, email, password });
      router.replace('/(tabs)');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not create your account. Please try again.');
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
            contentContainerClassName="grow justify-center px-6 py-10 gap-7"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View className="items-center gap-2">
              <Text className="text-white text-3xl font-extrabold">Create your account</Text>
              <Text className="text-white/85 text-base text-center">
                Manage your family&apos;s care with Premier Health.
              </Text>
            </View>

            <View className="bg-white rounded-3xl p-5 gap-4" style={cardShadow}>
              <View className="flex-row gap-3">
                <View className="flex-1 gap-1.5">
                  <Text className="text-ink-secondary text-sm font-semibold">First name</Text>
                  <TextInput
                    value={firstName}
                    onChangeText={setFirstName}
                    placeholder="First"
                    placeholderTextColor={colors.inkFaint}
                    autoCapitalize="words"
                    autoComplete="given-name"
                    className={inputClass}
                  />
                </View>
                <View className="flex-1 gap-1.5">
                  <Text className="text-ink-secondary text-sm font-semibold">Last name</Text>
                  <TextInput
                    value={lastName}
                    onChangeText={setLastName}
                    placeholder="Last"
                    placeholderTextColor={colors.inkFaint}
                    autoCapitalize="words"
                    autoComplete="family-name"
                    className={inputClass}
                  />
                </View>
              </View>

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
                  className={inputClass}
                />
              </View>

              <View className="gap-1.5">
                <Text className="text-ink-secondary text-sm font-semibold">Password</Text>
                <PasswordInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                />
              </View>

              <View className="gap-1.5">
                <Text className="text-ink-secondary text-sm font-semibold">Confirm password</Text>
                <PasswordInput
                  value={confirm}
                  onChangeText={setConfirm}
                  placeholder="Re-enter your password"
                  autoComplete="new-password"
                  returnKeyType="go"
                  onSubmitEditing={onRegister}
                />
              </View>

              {error ? <Text className="text-status-error text-sm">{error}</Text> : null}

              <Pressable
                onPress={onRegister}
                disabled={!canSubmit}
                className={`h-12 bg-phc-orange rounded-pill items-center justify-center ${
                  canSubmit ? '' : 'opacity-50'
                }`}
              >
                {busy ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text className="text-white text-base font-bold">Create account</Text>
                )}
              </Pressable>
            </View>

            <View className="items-center gap-1">
              <Text className="text-white/90 text-sm">Already have an account?</Text>
              <Link href="/(auth)/sign-in" asChild>
                <Pressable className="py-1">
                  <Text className="text-white text-base font-bold underline">Sign in</Text>
                </Pressable>
              </Link>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}
