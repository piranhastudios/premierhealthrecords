import type { Resource } from '@medplum/fhirtypes';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Card, EmptyState, Loading, Screen } from '../../../../src/components/ui';
import { useActiveProfile } from '../../../../src/hooks/useActiveProfile';
import { SUMMARY_SECTIONS } from '../../../../src/lib/constants';
import { SECTION_LABEL, summaryItemOf } from '../../../../src/lib/summary';
import { getSummarySection } from '../../../../src/offline/repositories';
import { colors } from '../../../../src/theme/tokens';

export default function Records(): JSX.Element {
  const router = useRouter();
  const { activePatient } = useActiveProfile();
  const [data, setData] = useState<Record<string, Resource[]>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activePatient?.id) {
      return;
    }
    setLoading(true);
    try {
      const result: Record<string, Resource[]> = {};
      for (const section of SUMMARY_SECTIONS) {
        result[section] = await getSummarySection<Resource>(activePatient.id, section);
      }
      setData(result);
    } finally {
      setLoading(false);
    }
  }, [activePatient?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <Screen edges={[]}>
        <Loading />
      </Screen>
    );
  }

  const empty = SUMMARY_SECTIONS.every((s) => (data[s]?.length ?? 0) === 0);
  if (empty) {
    return (
      <Screen edges={[]}>
        <EmptyState title="No summary yet" hint="Your records sync automatically when you're online." />
      </Screen>
    );
  }

  return (
    <Screen edges={[]}>
      <Text className="text-ink-faint text-xs mt-2">Saved on this device · available offline</Text>
      {SUMMARY_SECTIONS.map((section) => {
        const items = data[section] ?? [];
        if (items.length === 0) {
          return null;
        }
        return (
          <View key={section}>
            <Pressable
              onPress={() => router.push(`/(tabs)/profile/records/${section}`)}
              className="flex-row items-center justify-between mt-2 mb-1 active:opacity-70"
            >
              <Text className="text-ink font-bold">{SECTION_LABEL[section]}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.inkFaint} />
            </Pressable>
            <Card className="p-0 overflow-hidden">
              {items.map((resource, i) => {
                const item = summaryItemOf(resource);
                return (
                  <View key={resource.id ?? i} className={`px-4 py-3 ${i < items.length - 1 ? 'border-b border-line' : ''}`}>
                    <Text className="text-ink text-sm font-medium">{item.title}</Text>
                    {item.detail ? <Text className="text-ink-secondary text-xs mt-0.5">{item.detail}</Text> : null}
                  </View>
                );
              })}
            </Card>
          </View>
        );
      })}
    </Screen>
  );
}
