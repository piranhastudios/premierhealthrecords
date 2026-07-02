import { Ionicons } from '@expo/vector-icons';
import { useMedplum } from '@medplum/react-hooks';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { Button, Card, Screen } from '../../../src/components/ui';
import { colors } from '../../../src/theme/tokens';

export default function Settings(): JSX.Element {
  const medplum = useMedplum();
  const router = useRouter();
  const [language, setLanguage] = useState<'en' | 'fr'>('en');
  const [biometric, setBiometric] = useState(true);
  const [notifications, setNotifications] = useState(true);

  async function signOut(): Promise<void> {
    await medplum.signOut();
    router.replace('/(auth)/sign-in');
  }

  return (
    <Screen edges={[]}>
      <Card className="p-0 overflow-hidden mt-2">
        <View className="flex-row items-center px-4 py-3.5 border-b border-line">
          <Ionicons name="language" size={18} color={colors.orange} />
          <Text className="text-ink font-medium flex-1 ml-3">Language</Text>
          <View className="flex-row bg-surface-muted rounded-pill p-1">
            {(['en', 'fr'] as const).map((l) => (
              <Pressable key={l} onPress={() => setLanguage(l)} className={`px-3 py-1 rounded-pill ${language === l ? 'bg-phc-orange' : ''}`}>
                <Text className={`text-xs font-semibold uppercase ${language === l ? 'text-white' : 'text-ink-secondary'}`}>{l}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <Row icon="finger-print" label="Require Face ID for ID card" value={biometric} onChange={setBiometric} />
        <Row icon="notifications" label="Notifications" value={notifications} onChange={setNotifications} last />
      </Card>

      <Button label="Sign out" variant="danger" onPress={signOut} className="mt-2" />
      <Text className="text-ink-faint text-xs text-center mt-3">Premier Health · Cameroon</Text>
    </Screen>
  );
}

function Row({
  icon,
  label,
  value,
  onChange,
  last,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  last?: boolean;
}): JSX.Element {
  return (
    <View className={`flex-row items-center px-4 py-3.5 ${last ? '' : 'border-b border-line'}`}>
      <Ionicons name={icon} size={18} color={colors.orange} />
      <Text className="text-ink font-medium flex-1 ml-3">{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.orange }} />
    </View>
  );
}
