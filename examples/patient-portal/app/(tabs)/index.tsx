import { Ionicons } from '@expo/vector-icons';
import type { Appointment } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react-hooks';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ProfileBanner } from '../../src/components/ProfileBanner';
import { Avatar, Badge, Card, GradientHeader, Loading, Screen, SectionTitle, statusTone } from '../../src/components/ui';
import { useActiveProfile } from '../../src/hooks/useActiveProfile';
import { formatDate, patientInitials, patientName } from '../../src/lib/format';
import { getSummaryCounts } from '../../src/offline/repositories';
import { useSync } from '../../src/offline/SyncProvider';
import { colors } from '../../src/theme/tokens';

const SPECIALTIES = ['Dermatology', 'Cardiology', 'Pediatrics', 'Neurology', 'General'];
const SUMMARY_TILES: { key: string; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'allergy', label: 'Allergies', icon: 'alert-circle' },
  { key: 'medication', label: 'Medications', icon: 'medkit' },
  { key: 'condition', label: 'Conditions', icon: 'pulse' },
  { key: 'immunization', label: 'Vaccines', icon: 'shield-checkmark' },
];

function QuickAction({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }): JSX.Element {
  return (
    <Pressable onPress={onPress} className="items-center flex-1">
      <View className="w-14 h-14 rounded-2xl bg-phc-orange/12 items-center justify-center mb-1">
        <Ionicons name={icon} size={24} color={colors.orange} />
      </View>
      <Text className="text-ink-secondary text-xs font-medium">{label}</Text>
    </Pressable>
  );
}

export default function Home(): JSX.Element {
  const medplum = useMedplum();
  const router = useRouter();
  const { activePatient, holder } = useActiveProfile();
  const { syncing, refresh } = useSync();
  const [next, setNext] = useState<Appointment | undefined>();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activePatient?.id) {
      return;
    }
    setLoading(true);
    try {
      setCounts(await getSummaryCounts(activePatient.id));
      try {
        const today = new Date().toISOString().slice(0, 10);
        const upcoming = await medplum.searchResources(
          'Appointment',
          `patient=Patient/${activePatient.id}&date=ge${today}&_sort=date&_count=1`
        );
        setNext(upcoming[0]);
      } catch {
        setNext(undefined);
      }
    } finally {
      setLoading(false);
    }
  }, [medplum, activePatient?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const firstName = patientName(holder).split(' ')[0];

  return (
    <Screen refreshing={syncing} onRefresh={() => void refresh().then(load)}>
      <GradientHeader
        subtitle={`Hello${firstName ? `, ${firstName}` : ''}`}
        title="How are you feeling today?"
        right={
          <Pressable onPress={() => router.push('/(tabs)/profile')}>
            <Avatar initials={patientInitials(activePatient)} size={44} />
          </Pressable>
        }
      />

      <ProfileBanner />

      <Card>
        <View className="flex-row justify-between">
          <QuickAction icon="card" label="ID card" onPress={() => router.push('/(tabs)/profile/id-card')} />
          <QuickAction icon="calendar" label="Book" onPress={() => router.push('/(tabs)/appointments/search')} />
          <QuickAction icon="cash" label="Pay" onPress={() => router.push('/(tabs)/profile/invoices')} />
          <QuickAction icon="chatbubble-ellipses" label="Message" onPress={() => router.push('/(tabs)/messages')} />
        </View>
      </Card>

      <SectionTitle action={<Text className="text-phc-orange text-sm font-semibold" onPress={() => router.push('/(tabs)/appointments')}>See all</Text>}>
        Upcoming appointment
      </SectionTitle>
      {loading ? (
        <Loading />
      ) : next ? (
        <Card onPress={() => router.push(`/(tabs)/appointments/${next.id}`)}>
          <View className="flex-row items-center justify-between">
            <View className="flex-1">
              <Text className="text-ink font-semibold text-base">
                {next.appointmentType?.text ?? next.serviceType?.[0]?.text ?? 'Appointment'}
              </Text>
              <Text className="text-ink-secondary text-sm mt-0.5">{formatDate(next.start)}</Text>
            </View>
            <Badge label={next.status ?? 'booked'} tone={statusTone(next.status)} />
          </View>
        </Card>
      ) : (
        <Card>
          <Text className="text-ink-secondary text-sm">No upcoming appointments.</Text>
          <Text className="text-phc-orange text-sm font-semibold mt-1" onPress={() => router.push('/(tabs)/appointments/search')}>
            Find a doctor →
          </Text>
        </Card>
      )}

      <SectionTitle>Your health summary</SectionTitle>
      <View className="flex-row flex-wrap gap-3">
        {SUMMARY_TILES.map((t) => (
          <Card key={t.key} className="flex-1 min-w-[44%]">
            <Ionicons name={t.icon} size={20} color={colors.orange} />
            <Text className="text-ink text-2xl font-bold mt-2">{counts[t.key] ?? 0}</Text>
            <Text className="text-ink-secondary text-xs">{t.label}</Text>
          </Card>
        ))}
      </View>

      <SectionTitle>Find a doctor</SectionTitle>
      <View className="flex-row flex-wrap gap-2">
        {SPECIALTIES.map((s) => (
          <Pressable
            key={s}
            onPress={() => router.push(`/(tabs)/appointments/search?specialty=${encodeURIComponent(s)}`)}
            className="px-3.5 py-2 rounded-pill bg-surface-card"
          >
            <Text className="text-ink-secondary text-sm font-medium">{s}</Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}
