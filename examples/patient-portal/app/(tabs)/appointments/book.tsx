import { Ionicons } from '@expo/vector-icons';
import type { Location } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react-hooks';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Card, EmptyState, Loading, Screen, SectionTitle } from '../../../src/components/ui';
import { nurseVideoHref } from '../../../src/lib/booking';
import { colors } from '../../../src/theme/tokens';

/**
 * First step of booking: choose where the visit happens — a nurse video call,
 * or one of the physical centres (the doctor search is scoped to that site).
 */
export default function BookEntry(): JSX.Element {
  const medplum = useMedplum();
  const router = useRouter();
  // Home's specialty chips pass through to the doctor search at the chosen site.
  const { specialty } = useLocalSearchParams<{ specialty?: string }>();
  const [sites, setSites] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [nurseLoading, setNurseLoading] = useState(false);

  useEffect(() => {
    medplum
      .searchResources('Location', 'status=active&_sort=name&_count=50')
      .then((found) => setSites(found))
      .catch(() => setSites([]))
      .finally(() => setLoading(false));
  }, [medplum]);

  async function openNurseVideo(): Promise<void> {
    setNurseLoading(true);
    try {
      router.push(await nurseVideoHref(medplum));
    } finally {
      setNurseLoading(false);
    }
  }

  const searchHref = (siteId: string): string =>
    `/(tabs)/appointments/search?site=${siteId}${specialty ? `&specialty=${encodeURIComponent(specialty)}` : ''}`;

  return (
    <Screen edges={[]}>
      <Card onPress={() => void openNurseVideo()} className="mt-2">
        <View className="flex-row items-center">
          <View className="w-12 h-12 rounded-2xl bg-phc-orange/12 items-center justify-center mr-3">
            <Ionicons name="videocam" size={24} color={colors.orange} />
          </View>
          <View className="flex-1">
            <Text className="text-ink font-semibold">Video visit with a nurse</Text>
            <Text className="text-ink-secondary text-sm mt-0.5">A video call from wherever you are.</Text>
          </View>
          {nurseLoading ? (
            <ActivityIndicator color={colors.orange} />
          ) : (
            <Text className="text-phc-orange font-semibold text-sm">Book →</Text>
          )}
        </View>
      </Card>

      <SectionTitle>Visit a centre</SectionTitle>
      {loading ? (
        <Loading />
      ) : sites.length === 0 ? (
        <EmptyState title="No centres available" hint="Please check your connection and try again." />
      ) : (
        sites.map((site) => (
          <Card key={site.id} onPress={() => router.push(searchHref(String(site.id)))}>
            <View className="flex-row items-center">
              <View className="w-12 h-12 rounded-2xl bg-phc-orange/12 items-center justify-center mr-3">
                <Ionicons name="business" size={22} color={colors.orange} />
              </View>
              <View className="flex-1">
                <Text className="text-ink font-semibold">{site.name}</Text>
                {site.address?.city ? (
                  <Text className="text-ink-secondary text-sm mt-0.5">{site.address.city}</Text>
                ) : null}
              </View>
              <Text className="text-phc-orange font-semibold text-sm">Book →</Text>
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}
