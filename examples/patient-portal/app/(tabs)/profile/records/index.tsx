import { Ionicons } from '@expo/vector-icons';
import type { Resource } from '@medplum/fhirtypes';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { PatientIdentityCard } from '../../../../src/components/PatientIdentityCard';
import { Card, EmptyState, Loading, Screen } from '../../../../src/components/ui';
import { useActiveProfile } from '../../../../src/hooks/useActiveProfile';
import { SUMMARY_SECTIONS } from '../../../../src/lib/constants';
import { formatDate } from '../../../../src/lib/format';
import { SECTION_LABEL, summaryItemOf } from '../../../../src/lib/summary';
import { getSummarySection, getSummaryUpdatedAt } from '../../../../src/offline/repositories';
import { colors } from '../../../../src/theme/tokens';

/**
 * The medical summary, written to be read by a clinician the patient has never
 * met before — not just by the patient.
 *
 * That bar drives three things here: identity and record age sit at the top so
 * the record can be matched to a person and judged for staleness; sections keep
 * their clinical priority order (allergies first); and every row carries the
 * detail that makes it actionable — dose and route, value with reference range,
 * onset date — rather than only a name.
 *
 * Everything is read from the encrypted on-device database, so it works with no
 * signal, which is the situation this is for.
 */
export default function Records(): JSX.Element {
  const router = useRouter();
  const { activePatient } = useActiveProfile();
  const [data, setData] = useState<Record<string, Resource[]>>({});
  const [asOf, setAsOf] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activePatient?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result: Record<string, Resource[]> = {};
      for (const section of SUMMARY_SECTIONS) {
        result[section] = await getSummarySection<Resource>(activePatient.id, section);
      }
      setData(result);
      setAsOf(await getSummaryUpdatedAt(activePatient.id));
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

  return (
    <Screen edges={[]} refreshing={false} onRefresh={load}>
      <PatientIdentityCard patient={activePatient} asOf={asOf} />

      {empty ? (
        <EmptyState title="No summary yet" hint="Your records sync automatically when you're online." />
      ) : (
        SUMMARY_SECTIONS.map((section) => {
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
                <Text className="text-ink font-bold">
                  {SECTION_LABEL[section]} <Text className="text-ink-faint font-normal">({items.length})</Text>
                </Text>
                <Ionicons name="chevron-forward" size={16} color={colors.inkFaint} />
              </Pressable>
              <Card className="p-0 overflow-hidden">
                {items.map((resource, i) => {
                  const item = summaryItemOf(resource);
                  return (
                    <View
                      key={resource.id ?? i}
                      className={`px-4 py-3 ${i < items.length - 1 ? 'border-b border-line' : ''}`}
                    >
                      <View className="flex-row items-start justify-between">
                        <Text className="text-ink text-sm font-medium flex-1 pr-2">{item.title}</Text>
                        {item.abnormal ? (
                          <Text className="text-status-error text-xs font-bold">Abnormal</Text>
                        ) : null}
                      </View>
                      {item.detail ? <Text className="text-ink-secondary text-xs mt-0.5">{item.detail}</Text> : null}
                      {item.note ? <Text className="text-ink-faint text-xs mt-0.5">{item.note}</Text> : null}
                      {item.date ? <Text className="text-ink-faint text-xs mt-0.5">{formatDate(item.date)}</Text> : null}
                    </View>
                  );
                })}
              </Card>
            </View>
          );
        })
      )}
    </Screen>
  );
}
