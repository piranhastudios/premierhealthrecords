import type { Appointment } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react-hooks';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Badge, Card, EmptyState, GradientHeader, Loading, Screen, statusTone } from '../../../src/components/ui';
import { ProfileBanner } from '../../../src/components/ProfileBanner';
import { useActiveProfile } from '../../../src/hooks/useActiveProfile';
import { useNetworkStatus } from '../../../src/hooks/useNetworkStatus';
import { formatDate } from '../../../src/lib/format';

export default function AppointmentsList(): JSX.Element {
  const medplum = useMedplum();
  const router = useRouter();
  const { activePatient } = useActiveProfile();
  const { online } = useNetworkStatus();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');

  const load = useCallback(async () => {
    if (!activePatient?.id) {
      return;
    }
    setLoading(true);
    try {
      const results = await medplum.searchResources(
        'Appointment',
        `patient=Patient/${activePatient.id}&_sort=-date&_count=100`
      );
      setAppointments(results);
      setUnavailable(false);
    } catch {
      // Appointments are the one part of the record not held in the offline
      // cache, so with no signal we genuinely do not know. Say that, rather
      // than rendering "No upcoming appointments" at someone who has one.
      setAppointments([]);
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, [medplum, activePatient?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const now = Date.now();
  const filtered = useMemo(() => {
    return appointments.filter((a) => {
      const start = a.start ? new Date(a.start).getTime() : 0;
      return tab === 'upcoming' ? start >= now : start < now;
    });
  }, [appointments, tab, now]);

  return (
    <Screen
      refreshing={loading}
      onRefresh={load}
      hero={
        <GradientHeader
          safeTop
          title="Appointments"
          right={
            <Pressable onPress={() => router.push('/(tabs)/appointments/book')} className="bg-white/20 rounded-pill px-3 py-1.5">
              <Text className="text-white font-semibold text-sm">+ Book</Text>
            </Pressable>
          }
        />
      }
    >
      <ProfileBanner />

      <View className="flex-row bg-surface-card rounded-pill p-1">
        {(['upcoming', 'past'] as const).map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            className={`flex-1 py-2 rounded-pill items-center ${tab === t ? 'bg-phc-orange' : ''}`}
          >
            <Text className={`text-sm font-semibold capitalize ${tab === t ? 'text-white' : 'text-ink-secondary'}`}>{t}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <Loading />
      ) : unavailable ? (
        <EmptyState
          title="Appointments need a connection"
          hint={
            online
              ? 'We could not reach Premier Health just now. Pull down to try again.'
              : 'Your records below are saved on this device, but appointments are not. They will appear when you are back online.'
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState title={`No ${tab} appointments`} hint={tab === 'upcoming' ? 'Book a visit to get started.' : undefined} />
      ) : (
        filtered.map((a) => (
          <Card key={a.id} onPress={() => router.push(`/(tabs)/appointments/${a.id}`)}>
            <View className="flex-row items-center justify-between">
              <View className="flex-1">
                <Text className="text-ink font-semibold">{a.appointmentType?.text ?? a.serviceType?.[0]?.text ?? 'Appointment'}</Text>
                <Text className="text-ink-secondary text-sm mt-0.5">{formatDate(a.start)}</Text>
              </View>
              <Badge label={a.status ?? 'booked'} tone={statusTone(a.status)} />
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}
