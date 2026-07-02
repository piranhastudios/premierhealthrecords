import { useMedplum, useMedplumProfile } from '@medplum/react-hooks';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { heroGradient } from '../src/theme/tokens';

export default function Index(): JSX.Element {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    medplum
      .getInitPromise()
      .then(() => setReady(true))
      .catch(() => setReady(true));
  }, [medplum]);

  if (!ready) {
    return (
      <LinearGradient colors={heroGradient.colors as readonly [string, string, ...string[]]} className="flex-1 items-center justify-center">
        <Text className="text-white text-3xl font-extrabold mb-3">Premier Health</Text>
        <ActivityIndicator color="white" />
        <View className="h-8" />
      </LinearGradient>
    );
  }

  return <Redirect href={profile ? '/(tabs)' : '/(auth)/sign-in'} />;
}
