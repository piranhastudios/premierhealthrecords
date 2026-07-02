import { useMedplum } from '@medplum/react-hooks';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator } from 'react-native';
import { heroGradient } from '../../src/theme/tokens';

/** OAuth redirect handler (primarily the web target; native completes in-browser). */
export default function Callback(): JSX.Element {
  const medplum = useMedplum();
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();

  useEffect(() => {
    const code = params.code;
    if (typeof code === 'string' && code) {
      medplum
        .processCode(code)
        .then(() => router.replace('/(tabs)'))
        .catch(() => router.replace('/(auth)/sign-in'));
    } else {
      router.replace('/(auth)/sign-in');
    }
  }, [medplum, params.code, router]);

  return (
    <LinearGradient colors={heroGradient.colors as readonly [string, string, ...string[]]} className="flex-1 items-center justify-center">
      <ActivityIndicator color="white" />
    </LinearGradient>
  );
}
