import { normalizeErrorString } from '@medplum/core';
import { useMedplum } from '@medplum/react-hooks';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PasswordInput } from '../../../src/components/PasswordInput';
import { setNewPassword } from '../../../src/medplum/auth';
import { cardShadow, colors, heroGradient } from '../../../src/theme/tokens';

/**
 * In-app "set a new password" screen, opened from the password-reset email link
 * (`/setpassword/:id/:secret`, matched via universal link / the phc:// scheme).
 */
export default function SetPassword(): JSX.Element {
  const medplum = useMedplum();
  const router = useRouter();
  const { id, secret } = useLocalSearchParams<{ id: string; secret: string }>();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);

  const linkValid = Boolean(id && secret);
  const canSubmit = linkValid && password.length >= 8 && !busy;

  async function onSubmit(): Promise<void> {
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
      await setNewPassword(medplum, { id: id as string, secret: secret as string, password });
      setDone(true);
    } catch (err) {
      setError(normalizeErrorString(err));
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
              <Text className="text-white text-3xl font-extrabold">Set a new password</Text>
              <Text className="text-white/85 text-base text-center">
                Choose a new password for your Premier Health account.
              </Text>
            </View>

            {!linkValid ? (
              <View className="bg-white rounded-3xl p-5 gap-4" style={cardShadow}>
                <Text className="text-ink text-lg font-bold">Link not valid</Text>
                <Text className="text-ink-secondary text-base">
                  This reset link is incomplete or has expired. Please request a new one.
                </Text>
                <Pressable
                  onPress={() => router.replace('/(auth)/forgot-password')}
                  className="h-12 bg-phc-orange rounded-pill items-center justify-center"
                >
                  <Text className="text-white text-base font-bold">Request a new link</Text>
                </Pressable>
              </View>
            ) : done ? (
              <View className="bg-white rounded-3xl p-5 gap-4" style={cardShadow}>
                <Text className="text-ink text-lg font-bold">Password updated</Text>
                <Text className="text-ink-secondary text-base">
                  Your password has been changed. You can now sign in with your new password.
                </Text>
                <Pressable
                  onPress={() => router.replace('/(auth)/sign-in')}
                  className="h-12 bg-phc-orange rounded-pill items-center justify-center"
                >
                  <Text className="text-white text-base font-bold">Sign in</Text>
                </Pressable>
              </View>
            ) : (
              <View className="bg-white rounded-3xl p-5 gap-4" style={cardShadow}>
                <View className="gap-1.5">
                  <Text className="text-ink-secondary text-sm font-semibold">New password</Text>
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
                    <Text className="text-white text-base font-bold">Update password</Text>
                  )}
                </Pressable>
              </View>
            )}

            <View className="items-center">
              <Pressable className="py-1" onPress={() => router.replace('/(auth)/sign-in')}>
                <Text className="text-white text-base font-bold underline">Back to sign in</Text>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}
