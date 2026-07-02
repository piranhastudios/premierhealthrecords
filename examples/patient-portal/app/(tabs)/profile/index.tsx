import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { Avatar, Card, GradientHeader, Screen } from '../../../src/components/ui';
import { useActiveProfile } from '../../../src/hooks/useActiveProfile';
import { patientCni, patientInitials, patientName } from '../../../src/lib/format';
import { colors } from '../../../src/theme/tokens';

const MENU: { icon: keyof typeof Ionicons.glyphMap; label: string; route: string }[] = [
  { icon: 'card', label: 'Health ID card', route: '/(tabs)/profile/id-card' },
  { icon: 'people', label: 'Family members', route: '/(tabs)/profile/family' },
  { icon: 'document-text', label: 'Medical summary', route: '/(tabs)/profile/records' },
  { icon: 'cash', label: 'Payments & invoices', route: '/(tabs)/profile/invoices' },
  { icon: 'settings', label: 'Settings', route: '/(tabs)/profile/settings' },
];

export default function ProfileHome(): JSX.Element {
  const router = useRouter();
  const { activePatient } = useActiveProfile();

  return (
    <Screen>
      <GradientHeader title="Profile" />
      <Card className="items-center -mt-2">
        <Avatar initials={patientInitials(activePatient)} size={72} />
        <Text className="text-ink text-xl font-bold mt-3">{patientName(activePatient)}</Text>
        {patientCni(activePatient) ? <Text className="text-ink-secondary text-sm">CNI · {patientCni(activePatient)}</Text> : null}
      </Card>

      <Card className="p-0 overflow-hidden">
        {MENU.map((m, i) => (
          <Pressable
            key={m.route}
            onPress={() => router.push(m.route)}
            className={`flex-row items-center px-4 py-3.5 ${i < MENU.length - 1 ? 'border-b border-line' : ''}`}
          >
            <View className="w-9 h-9 rounded-xl bg-phc-orange/12 items-center justify-center">
              <Ionicons name={m.icon} size={18} color={colors.orange} />
            </View>
            <Text className="text-ink font-medium flex-1 ml-3">{m.label}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.inkFaint} />
          </Pressable>
        ))}
      </Card>
    </Screen>
  );
}
