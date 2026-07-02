import type { Resource } from '@medplum/fhirtypes';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Card, EmptyState, Loading, Screen } from '../../../src/components/ui';
import { useActiveProfile } from '../../../src/hooks/useActiveProfile';
import { SUMMARY_SECTIONS, type SummarySection } from '../../../src/lib/constants';
import { getSummarySection } from '../../../src/offline/repositories';

const SECTION_LABEL: Record<SummarySection, string> = {
  allergy: 'Allergies',
  medication: 'Medications',
  condition: 'Conditions',
  immunization: 'Immunizations',
  lab: 'Recent labs',
  encounter: 'Recent visits',
};

/** Pull a human label out of any IPS resource. */
function labelOf(resource: Resource): string {
  const r = resource as unknown as Record<string, unknown>;
  const cc = (r.code ?? r.vaccineCode ?? r.medicationCodeableConcept) as { text?: string; coding?: { display?: string }[] } | undefined;
  const medRef = (r.medicationReference as { display?: string } | undefined)?.display;
  const type = (r.type as { text?: string; coding?: { display?: string }[] }[] | undefined)?.[0];
  return cc?.text ?? cc?.coding?.[0]?.display ?? medRef ?? type?.text ?? type?.coding?.[0]?.display ?? resource.resourceType;
}

export default function Records(): JSX.Element {
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
            <Text className="text-ink font-bold mt-2 mb-1">{SECTION_LABEL[section]}</Text>
            <Card className="p-0 overflow-hidden">
              {items.map((item, i) => (
                <View key={item.id ?? i} className={`px-4 py-3 ${i < items.length - 1 ? 'border-b border-line' : ''}`}>
                  <Text className="text-ink text-sm font-medium">{labelOf(item)}</Text>
                </View>
              ))}
            </Card>
          </View>
        );
      })}
    </Screen>
  );
}
