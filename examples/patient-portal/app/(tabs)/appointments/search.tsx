import type { Practitioner, PractitionerRole, Resource } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react-hooks';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Avatar, Card, EmptyState, Loading, Screen } from '../../../src/components/ui';
import { formatHumanName, patientInitials } from '../../../src/lib/format';

interface DoctorResult {
  practitioner: Practitioner;
  specialty?: string;
}

export default function DoctorSearch(): JSX.Element {
  const medplum = useMedplum();
  const router = useRouter();
  const params = useLocalSearchParams<{ specialty?: string }>();
  const [query, setQuery] = useState('');
  const [specialty, setSpecialty] = useState<string | undefined>(params.specialty);
  const [results, setResults] = useState<DoctorResult[]>([]);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async () => {
    setLoading(true);
    try {
      const parts: string[] = ['_include=PractitionerRole:practitioner', '_count=25'];
      if (specialty) {
        parts.push(`specialty:text=${encodeURIComponent(specialty)}`);
      }
      const bundle = await medplum.search('PractitionerRole', parts.join('&'));
      // _include brings Practitioner resources alongside the PractitionerRoles, but
      // the static Bundle type is PractitionerRole-only — widen before filtering.
      const resources = (bundle.entry ?? [])
        .map((e) => e.resource as Resource | undefined)
        .filter((r): r is Resource => Boolean(r));
      const roles = resources.filter((r): r is PractitionerRole => r.resourceType === 'PractitionerRole');
      const practitioners = resources.filter((r): r is Practitioner => r.resourceType === 'Practitioner');

      let docs: DoctorResult[] = practitioners.map((p) => ({
        practitioner: p,
        specialty: roles.find((r) => r.practitioner?.reference === `Practitioner/${p.id}`)?.specialty?.[0]?.text,
      }));

      // Fallback to a plain practitioner search when no roles are configured.
      if (docs.length === 0) {
        const plain = await medplum.searchResources('Practitioner', query ? `name=${encodeURIComponent(query)}&_count=25` : '_count=25');
        docs = plain.map((p) => ({ practitioner: p }));
      }

      const q = query.trim().toLowerCase();
      setResults(q ? docs.filter((d) => formatHumanName(d.practitioner.name).toLowerCase().includes(q)) : docs);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [medplum, specialty, query]);

  useEffect(() => {
    void search();
  }, [search]);

  return (
    <Screen edges={[]}>
      <View className="bg-surface-card rounded-field flex-row items-center px-3 mt-2">
        <TextInput
          placeholder="Search a doctor or specialty"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => void search()}
          returnKeyType="search"
          className="flex-1 h-12 text-ink"
          placeholderTextColor="#9A8B82"
        />
      </View>

      {specialty ? (
        <View className="flex-row items-center gap-2">
          <Text className="text-ink-secondary text-sm">Specialty:</Text>
          <Pressable onPress={() => setSpecialty(undefined)} className="px-3 py-1.5 rounded-pill bg-phc-orange/15 flex-row items-center">
            <Text className="text-phc-orange text-sm font-semibold">{specialty} ✕</Text>
          </Pressable>
        </View>
      ) : null}

      {loading ? (
        <Loading />
      ) : results.length === 0 ? (
        <EmptyState title="No doctors found" hint="Try a different name or specialty." />
      ) : (
        results.map((d) => (
          <Card key={d.practitioner.id} onPress={() => router.push(`/(tabs)/appointments/doctor/${d.practitioner.id}`)}>
            <View className="flex-row items-center">
              <Avatar initials={patientInitials(d.practitioner as never)} size={48} />
              <View className="ml-3 flex-1">
                <Text className="text-ink font-semibold">{formatHumanName(d.practitioner.name)}</Text>
                {d.specialty ? <Text className="text-ink-secondary text-sm">{d.specialty}</Text> : null}
              </View>
              <Text className="text-phc-orange font-semibold text-sm">Book →</Text>
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}
