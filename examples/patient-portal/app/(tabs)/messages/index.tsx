import type { Communication } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react-hooks';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Avatar, Card, EmptyState, GradientHeader, Loading, Screen } from '../../../src/components/ui';
import { ProfileBanner } from '../../../src/components/ProfileBanner';
import { useActiveProfile } from '../../../src/hooks/useActiveProfile';
import { formatDate } from '../../../src/lib/format';

export default function ThreadList(): JSX.Element {
  const medplum = useMedplum();
  const router = useRouter();
  const { activePatient } = useActiveProfile();
  const [threads, setThreads] = useState<Communication[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activePatient?.id) {
      return;
    }
    setLoading(true);
    try {
      // Thread headers = top-level Communications (no part-of).
      const results = await medplum.searchResources(
        'Communication',
        `subject=Patient/${activePatient.id}&part-of:missing=true&_sort=-sent&_count=50`
      );
      setThreads(results);
    } catch {
      setThreads([]);
    } finally {
      setLoading(false);
    }
  }, [medplum, activePatient?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen refreshing={loading} onRefresh={load}>
      <GradientHeader title="Messages" subtitle="Your care team" />
      <ProfileBanner />

      {loading ? (
        <Loading />
      ) : threads.length === 0 ? (
        <EmptyState title="No conversations yet" hint="Messages from your care team will appear here." />
      ) : (
        threads.map((t) => {
          const title = t.topic?.text ?? t.payload?.[0]?.contentString ?? 'Conversation';
          return (
            <Card key={t.id} onPress={() => router.push(`/(tabs)/messages/${t.id}`)}>
              <View className="flex-row items-center">
                <Avatar initials="PH" size={44} />
                <View className="ml-3 flex-1">
                  <Text className="text-ink font-semibold" numberOfLines={1}>
                    {title}
                  </Text>
                  <Text className="text-ink-secondary text-sm" numberOfLines={1}>
                    {t.payload?.[0]?.contentString ?? 'Tap to view'}
                  </Text>
                </View>
                <Text className="text-ink-faint text-xs">{formatDate(t.sent)}</Text>
              </View>
            </Card>
          );
        })
      )}
    </Screen>
  );
}
