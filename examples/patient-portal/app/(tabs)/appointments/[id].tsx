import { Ionicons } from '@expo/vector-icons';
import type { Appointment } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react-hooks';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Badge, Button, Card, Loading, Screen, statusTone } from '../../../src/components/ui';
import { formatDate } from '../../../src/lib/format';
import { colors } from '../../../src/theme/tokens';

export default function AppointmentDetail(): JSX.Element {
  const medplum = useMedplum();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [appointment, setAppointment] = useState<Appointment>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setAppointment(await medplum.readResource('Appointment', String(id)));
    } finally {
      setLoading(false);
    }
  }, [medplum, id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function cancel(): Promise<void> {
    if (!appointment) {
      return;
    }
    setBusy(true);
    try {
      const updated = await medplum.updateResource({ ...appointment, status: 'cancelled' });
      setAppointment(updated);
    } catch {
      Alert.alert('Could not cancel', 'Please try again when you have a connection.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <Screen edges={[]}>
        <Loading />
      </Screen>
    );
  }
  if (!appointment) {
    return (
      <Screen edges={[]}>
        <Text className="text-ink-secondary mt-6">Appointment not found.</Text>
      </Screen>
    );
  }

  const isVideo = appointment.appointmentType?.coding?.some((c) => /telehealth|video|virtual/i.test(c.code ?? c.display ?? ''));
  const active = appointment.status !== 'cancelled' && appointment.status !== 'noshow';

  return (
    <Screen edges={[]}>
      <Card className="mt-2">
        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-ink text-lg font-bold">
            {appointment.appointmentType?.text ?? appointment.serviceType?.[0]?.text ?? 'Appointment'}
          </Text>
          <Badge label={appointment.status ?? 'booked'} tone={statusTone(appointment.status)} />
        </View>
        <Detail icon="calendar" label="When" value={formatDate(appointment.start)} />
        <Detail icon="time" label="Time" value={appointment.start ? new Date(appointment.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'} />
        {appointment.description ? <Detail icon="document-text" label="Reason" value={appointment.description} /> : null}
      </Card>

      {active ? (
        <View className="gap-3 mt-2">
          {isVideo ? <Button label="Join video visit" onPress={() => router.push(`/visit/${appointment.id}`)} /> : null}
          <Button
            label="Check in with QR"
            variant="secondary"
            onPress={() => router.push(`/(tabs)/profile/id-card?intent=checkin`)}
          />
          <Button label="Cancel appointment" variant="ghost" onPress={cancel} loading={busy} />
        </View>
      ) : null}
    </Screen>
  );
}

function Detail({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }): JSX.Element {
  return (
    <View className="flex-row items-center py-1.5">
      <Ionicons name={icon} size={18} color={colors.inkFaint} />
      <Text className="text-ink-secondary text-sm w-16 ml-2">{label}</Text>
      <Text className="text-ink text-sm font-medium flex-1">{value}</Text>
    </View>
  );
}
