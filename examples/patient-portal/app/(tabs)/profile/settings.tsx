import { Ionicons } from '@expo/vector-icons';
import { useMedplum } from '@medplum/react-hooks';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { Button, Card, Screen } from '../../../src/components/ui';
import {
  authenticateForUnlock,
  getLockCapability,
  isAppLockEnabled,
  setAppLockEnabled,
  type LockCapability,
} from '../../../src/lib/appLock';
import { logout } from '../../../src/medplum/auth';
import { colors } from '../../../src/theme/tokens';

export default function Settings(): JSX.Element {
  const medplum = useMedplum();
  const router = useRouter();
  const [language, setLanguage] = useState<'en' | 'fr'>('en');
  const [notifications, setNotifications] = useState(true);
  const [lockOn, setLockOn] = useState(false);
  const [capability, setCapability] = useState<LockCapability>('none');

  useEffect(() => {
    void (async () => {
      setCapability(await getLockCapability());
      setLockOn(await isAppLockEnabled());
    })();
  }, []);

  // Turning the lock ON requires passing the challenge first. Otherwise someone
  // could enable it with a biometric that does not actually work on this device
  // and lock the owner out of their own records.
  const toggleLock = useCallback(async (next: boolean) => {
    if (next && !(await authenticateForUnlock('Confirm to turn on app lock'))) {
      return;
    }
    await setAppLockEnabled(next);
    setLockOn(next);
  }, []);

  async function signOut(): Promise<void> {
    await logout(medplum);
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
        <Row
          icon="finger-print"
          label={capability === 'passcode' ? 'Require passcode to open' : 'Require Face ID to open'}
          value={lockOn}
          onChange={(v) => void toggleLock(v)}
          disabled={capability === 'none'}
          hint={
            capability === 'none'
              ? 'Set a screen lock on this device to use this.'
              : 'Asked for each time you open the app.'
          }
        />
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
  disabled,
  hint,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  last?: boolean;
  disabled?: boolean;
  hint?: string;
}): JSX.Element {
  return (
    <View className={`flex-row items-center px-4 py-3.5 ${last ? '' : 'border-b border-line'}`}>
      <Ionicons name={icon} size={18} color={disabled ? colors.inkFaint : colors.orange} />
      <View className="flex-1 ml-3">
        <Text className={`font-medium ${disabled ? 'text-ink-faint' : 'text-ink'}`}>{label}</Text>
        {hint ? <Text className="text-ink-faint text-xs mt-0.5">{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: colors.orange }} />
    </View>
  );
}
