import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useActiveProfile } from '../hooks/useActiveProfile';
import { patientInitials, patientName } from '../lib/format';
import { Avatar } from './ui';

/**
 * Always-visible "who am I viewing" banner. Safety-critical when a holder manages
 * several family profiles — every clinical/payment screen reads the active profile.
 */
export function ProfileBanner(): JSX.Element | null {
  const { activePatient, profiles } = useActiveProfile();
  const router = useRouter();
  if (!activePatient) {
    return null;
  }
  const switchable = profiles.length > 1;
  return (
    <Pressable
      onPress={() => switchable && router.push('/(tabs)/profile/family')}
      className="mx-5 -mt-4 mb-1 flex-row items-center bg-surface-card rounded-pill px-3 py-2"
      style={{ shadowColor: '#C24E12', shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 }}
    >
      <Avatar initials={patientInitials(activePatient)} size={28} />
      <Text className="ml-2 text-ink text-sm font-semibold flex-1">Viewing: {patientName(activePatient)}</Text>
      {switchable ? <Text className="text-phc-orange text-xs font-semibold">Switch</Text> : null}
    </Pressable>
  );
}
