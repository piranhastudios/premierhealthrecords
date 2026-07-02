import { useMedplum, useMedplumProfile } from '@medplum/react-hooks';
import type { Parameters } from '@medplum/fhirtypes';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Screen } from '../../../src/components/ui';
import { login } from '../../../src/medplum/auth';

/**
 * Adult-relative invite claim. The holder sends a one-time token (via WhatsApp/email
 * bot); opening phc://claim/<token> lands here. After sign-in we POST the token to a
 * server $claim-family-invite op that links the new login back to the family.
 */
export default function ClaimInvite(): JSX.Element {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token: string }>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();

  async function claim(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      if (!profile) {
        const p = await login(medplum);
        if (!p) {
          setBusy(false);
          return;
        }
      }
      const params: Parameters = {
        resourceType: 'Parameters',
        parameter: [{ name: 'token', valueString: String(token) }],
      };
      await medplum.post(medplum.fhirUrl('Patient', '$claim-family-invite'), params);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not claim the invite.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll={false}>
      <View className="flex-1 justify-center gap-4">
        <Text className="text-ink text-2xl font-bold">Join your family on Premier Health</Text>
        <Text className="text-ink-secondary">
          You&apos;ve been invited to link your Premier Health record. Sign in (or create your account) to
          accept and keep your own private login.
        </Text>
        {done ? (
          <View className="gap-3">
            <Text className="text-status-success font-semibold">You&apos;re linked. Welcome!</Text>
            <Button label="Go to my health" onPress={() => router.replace('/(tabs)')} />
          </View>
        ) : (
          <Button label="Accept invite" onPress={claim} loading={busy} />
        )}
        {error ? <Text className="text-status-error text-sm">{error}</Text> : null}
      </View>
    </Screen>
  );
}
