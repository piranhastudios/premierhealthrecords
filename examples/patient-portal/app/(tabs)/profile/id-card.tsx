import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { IdCard } from '../../../src/components/IdCard';
import { Card, EmptyState, Screen } from '../../../src/components/ui';
import { useActiveProfile } from '../../../src/hooks/useActiveProfile';
import type { QrIntent } from '../../../src/qr/types';
import { colors } from '../../../src/theme/tokens';

const TIPS: { icon: keyof typeof Ionicons.glyphMap; text: string }[] = [
  { icon: 'finger-print', text: 'Your code is locked behind Face ID / fingerprint.' },
  { icon: 'refresh', text: 'It rotates every 30 seconds and cannot be reused.' },
  { icon: 'cloud-offline', text: 'Identify & check-in work offline; pay & share need internet.' },
];

export default function HealthIdScreen(): JSX.Element {
  const { activePatient } = useActiveProfile();
  const { intent } = useLocalSearchParams<{ intent?: QrIntent }>();

  if (!activePatient) {
    return (
      <Screen edges={[]}>
        <EmptyState title="No profile selected" />
      </Screen>
    );
  }

  return (
    <Screen edges={[]}>
      <View className="mt-3">
        <IdCard patient={activePatient} initialIntent={intent ?? 'id'} />
      </View>

      <Card className="mt-10">
        {TIPS.map((t, i) => (
          <View key={i} className={`flex-row items-center py-2 ${i < TIPS.length - 1 ? 'border-b border-line' : ''}`}>
            <Ionicons name={t.icon} size={18} color={colors.orange} />
            <Text className="text-ink-secondary text-sm ml-3 flex-1">{t.text}</Text>
          </View>
        ))}
      </Card>
    </Screen>
  );
}
