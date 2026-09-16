import type { Resource } from '@medplum/fhirtypes';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { PatientIdentityCard } from '../../../src/components/PatientIdentityCard';
import { Badge, Card, EmptyState, Loading, Screen, statusTone } from '../../../src/components/ui';
import { useActiveProfile } from '../../../src/hooks/useActiveProfile';
import { SUMMARY_SECTIONS, type SummarySection } from '../../../src/lib/constants';
import { formatDate } from '../../../src/lib/format';
import { SECTION_EMPTY_HINT, SECTION_LABEL, summaryItemOf } from '../../../src/lib/summary';
import { getSummaryUpdatedAt } from '../../../src/offline/repositories';

function isSection(value: string | undefined): value is SummarySection {
  return SUMMARY_SECTIONS.includes(value as SummarySection);
}

/**
 * One category of the medical summary — what the home-screen tiles open.
 *
 * Reads only from the encrypted on-device cache, never the network: these are
 * the records a patient needs to be able to show a clinician when there is no
 * signal, which is the point of the app.
 */
export default function RecordSection(): JSX.Element {
  const { section } = useLocalSearchParams<{ section: string }>();
  const { activePatient } = useActiveProfile();
  const [items, setItems] = useState<Resource[]>([]);
  const [asOf, setAsOf] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  const valid = isSection(section);

  const load = useCallback(async () => {
    if (!activePatient?.id || !isSection(section)) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { getSummarySection } = await import('../../../src/offline/repositories');
      setItems(await getSummarySection<Resource>(activePatient.id, section));
      setAsOf(await getSummaryUpdatedAt(activePatient.id));
    } finally {
      setLoading(false);
    }
  }, [activePatient?.id, section]);

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

  if (!valid) {
    return (
      <Screen edges={[]}>
        <EmptyState title="Not part of your summary" hint="That section does not exist." />
      </Screen>
    );
  }

  if (items.length === 0) {
    return (
      <Screen edges={[]} refreshing={false} onRefresh={load}>
        <EmptyState title={`No ${SECTION_LABEL[section].toLowerCase()} recorded`} hint={SECTION_EMPTY_HINT[section]} />
      </Screen>
    );
  }

  return (
    <Screen edges={[]} refreshing={false} onRefresh={load}>
      <Stack.Screen options={{ title: SECTION_LABEL[section] }} />
      {/* Someone may be handed the phone on this screen rather than the summary,
          so identity and record age have to travel with the detail. */}
      <PatientIdentityCard patient={activePatient} asOf={asOf} />
      {items.map((resource, i) => {
        const item = summaryItemOf(resource);
        return (
          <Card key={resource.id ?? i}>
            <View className="flex-row items-start justify-between">
              <View className="flex-1 pr-3">
                <Text className="text-ink font-semibold text-base">{item.title}</Text>
                {item.detail ? <Text className="text-ink-secondary text-sm mt-0.5">{item.detail}</Text> : null}
                {item.note ? <Text className="text-ink-faint text-xs mt-0.5">{item.note}</Text> : null}
                {item.date ? <Text className="text-ink-faint text-xs mt-1">{formatDate(item.date)}</Text> : null}
              </View>
              <View className="items-end gap-1">
                {item.status ? <Badge label={item.status} tone={statusTone(item.status)} /> : null}
                {item.abnormal ? <Text className="text-status-error text-xs font-bold">Abnormal</Text> : null}
              </View>
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}
