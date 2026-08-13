import type { Appointment, Practitioner, Slot } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react-hooks';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Avatar, Button, Card, Loading, Screen } from '../../../../src/components/ui';
import { useNetworkStatus } from '../../../../src/hooks/useNetworkStatus';
import { useActiveProfile } from '../../../../src/hooks/useActiveProfile';
import { formatHumanName, patientInitials } from '../../../../src/lib/format';
import { queueBooking } from '../../../../src/offline/sync';

export default function DoctorProfile(): JSX.Element {
  const medplum = useMedplum();
  const router = useRouter();
  const { online } = useNetworkStatus();
  const { activePatient } = useActiveProfile();
  const { doctorId } = useLocalSearchParams<{ doctorId: string }>();
  const [doctor, setDoctor] = useState<Practitioner>();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const practitioner = await medplum.readResource('Practitioner', String(doctorId));
      setDoctor(practitioner);
      try {
        // Only THIS doctor's published slots: resolve their Schedule(s) first —
        // an unfiltered Slot search would list every free slot in the project.
        const schedules = await medplum.searchResources('Schedule', `actor=Practitioner/${doctorId}&_count=10`);
        if (schedules.length === 0) {
          setSlots([]);
          return;
        }
        const now = new Date().toISOString();
        const scheduleRefs = schedules.map((s) => `Schedule/${s.id}`).join(',');
        const free = await medplum.searchResources(
          'Slot',
          `schedule=${scheduleRefs}&status=free&start=ge${now}&_sort=start&_count=8`
        );
        setSlots(free);
      } catch {
        setSlots([]);
      }
    } finally {
      setLoading(false);
    }
  }, [medplum, doctorId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function book(slot?: Slot): Promise<void> {
    if (!activePatient?.id || !doctor?.id) {
      return;
    }
    // New-patient bookings default to the agreed 30 minutes; a chosen slot keeps
    // its own published duration.
    const start = slot?.start ?? new Date(Date.now() + 86_400_000).toISOString();
    const end = slot?.end ?? new Date(Date.now() + 86_400_000 + 1_800_000).toISOString();
    const idempotencyKey = `book-${activePatient.id}-${doctor.id}-${start}`;
    const appointment: Appointment = {
      resourceType: 'Appointment',
      status: 'proposed',
      identifier: [{ system: 'https://premierhealth.cm/fhir/sid/booking', value: idempotencyKey }],
      appointmentType: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/v2-0276',
            code: 'ROUTINE',
            display: 'Routine appointment - default if not valued',
          },
        ],
      },
      start,
      end,
      slot: slot?.id ? [{ reference: `Slot/${slot.id}` }] : undefined,
      participant: [
        { actor: { reference: `Patient/${activePatient.id}` }, status: 'accepted' },
        { actor: { reference: `Practitioner/${doctor.id}` }, status: 'needs-action' },
      ],
    };
    setBooking(slot?.id ?? 'request');
    try {
      if (online && slot) {
        // Proper booking: $book marks the slot busy and rejects double-booking.
        // Fall back to a plain request if the operation is not permitted for
        // patient sessions on this server.
        try {
          await medplum.post(medplum.fhirUrl('Appointment', '$book'), {
            resourceType: 'Parameters',
            parameter: [
              { name: 'slot', resource: slot },
              { name: 'patient-reference', valueReference: { reference: `Patient/${activePatient.id}` } },
            ],
          });
        } catch {
          await medplum.createResource(appointment);
        }
      } else if (online) {
        await medplum.createResource(appointment);
      } else {
        await queueBooking(appointment, idempotencyKey);
      }
      Alert.alert(
        online ? 'Appointment requested' : 'Saved offline',
        online ? 'Your request was sent. You will be notified when it is confirmed.' : 'It will be sent automatically when you reconnect.'
      );
      router.replace('/(tabs)/appointments');
    } catch {
      Alert.alert('Could not book', 'Please try again.');
    } finally {
      setBooking(undefined);
    }
  }

  if (loading) {
    return (
      <Screen edges={[]}>
        <Loading />
      </Screen>
    );
  }

  return (
    <Screen edges={[]}>
      <Card className="mt-2 items-center">
        <Avatar initials={patientInitials(doctor as never)} size={72} />
        <Text className="text-ink text-xl font-bold mt-3">{formatHumanName(doctor?.name)}</Text>
        <Text className="text-ink-secondary text-sm">{doctor?.qualification?.[0]?.code?.text ?? 'Practitioner'}</Text>
      </Card>

      <Text className="text-ink text-lg font-bold mt-2">Available times</Text>
      {slots.length > 0 ? (
        <View className="flex-row flex-wrap gap-2">
          {slots.map((s) => (
            <Pressable
              key={s.id}
              onPress={() => book(s)}
              className={`px-3.5 py-2.5 rounded-field bg-surface-card ${booking === s.id ? 'opacity-50' : ''}`}
            >
              <Text className="text-ink text-sm font-medium">
                {s.start ? new Date(s.start).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : 'Slot'}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Text className="text-ink-secondary text-sm">No published slots. You can still request an appointment.</Text>
      )}

      <Button label="Request appointment" onPress={() => book()} loading={booking === 'request'} className="mt-2" />
    </Screen>
  );
}
