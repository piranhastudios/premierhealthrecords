import type { Location, Practitioner, PractitionerRole, Resource } from '@medplum/fhirtypes';
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
  const params = useLocalSearchParams<{ specialty?: string; site?: string }>();
  const [query, setQuery] = useState('');
  const [specialty, setSpecialty] = useState<string | undefined>(params.specialty);
  // Sites (FHIR Location). Undefined = every site.
  const [sites, setSites] = useState<Location[]>([]);
  const [siteId, setSiteId] = useState<string | undefined>(params.site);
  const [results, setResults] = useState<DoctorResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    medplum
      .searchResources('Location', 'status=active&_sort=name&_count=50')
      .then((found) => setSites(found))
      .catch(() => setSites([]));
  }, [medplum]);

  const search = useCallback(async () => {
    setLoading(true);
    try {
      const parts: string[] = ['_include=PractitionerRole:practitioner', '_count=25'];
      if (specialty) {
        parts.push(`specialty:text=${encodeURIComponent(specialty)}`);
      }
      if (siteId) {
        // PractitionerRole.location is one role per (doctor × site), seeded server-side.
        parts.push(`location=Location/${siteId}`);
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

      // Fallback to a plain practitioner search when no roles are configured
      // (only when not filtering by site: a site with no roles has no doctors).
      if (docs.length === 0 && !siteId) {
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
  }, [medplum, specialty, query, siteId]);

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

      {sites.length > 1 ? (
        <View className="flex-row flex-wrap items-center gap-2">
          <Pressable
            onPress={() => setSiteId(undefined)}
            className={`px-3 py-1.5 rounded-pill ${siteId ? 'bg-surface-card' : 'bg-phc-orange/15'}`}
          >
            <Text className={`text-sm font-semibold ${siteId ? 'text-ink-secondary' : 'text-phc-orange'}`}>All sites</Text>
          </Pressable>
          {sites.map((site) => (
            <Pressable
              key={site.id}
              onPress={() => setSiteId(site.id)}
              className={`px-3 py-1.5 rounded-pill ${siteId === site.id ? 'bg-phc-orange/15' : 'bg-surface-card'}`}
            >
              <Text className={`text-sm font-semibold ${siteId === site.id ? 'text-phc-orange' : 'text-ink-secondary'}`}>
                {site.name}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

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
          <Card
            key={d.practitioner.id}
            onPress={() =>
              router.push(`/(tabs)/appointments/doctor/${d.practitioner.id}${siteId ? `?site=${siteId}` : ''}`)
            }
          >
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
