import type { WithId } from '@medplum/core';
import type { Appointment, Bundle, HealthcareService, Location, Practitioner, Schedule, Slot } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react-hooks';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Avatar, Button, Card, Loading, Screen } from '../../../../src/components/ui';
import { useNetworkStatus } from '../../../../src/hooks/useNetworkStatus';
import { useActiveProfile } from '../../../../src/hooks/useActiveProfile';
import { formatHumanName, patientInitials } from '../../../../src/lib/format';
import { queueBooking } from '../../../../src/offline/sync';

// Schedule.serviceType entries embed the HealthcareService they refer to
// (see packages/server/src/util/servicetype.ts).
const SERVICE_TYPE_REFERENCE_URL = 'https://medplum.com/fhir/service-type-reference';
// How far ahead $find looks (server maximum is 31 days).
const FIND_WINDOW_DAYS = 14;
// Don't offer slots starting in the next 30 minutes.
const MIN_NOTICE_MS = 30 * 60_000;
const MAX_SLOTS = 24;

function siteRefOf(schedule: Schedule): string | undefined {
  return schedule.actor?.find((actor) => actor.reference?.startsWith('Location/'))?.reference;
}

function serviceRefsOf(schedule: Schedule): string[] {
  const refs = (schedule.serviceType ?? [])
    .map((concept) => concept.extension?.find((e) => e.url === SERVICE_TYPE_REFERENCE_URL)?.valueReference?.reference)
    .filter((ref): ref is string => Boolean(ref));
  return Array.from(new Set(refs));
}

function formatSlot(start?: string): string {
  return start
    ? new Date(start).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : 'Slot';
}

export default function DoctorProfile(): JSX.Element {
  const medplum = useMedplum();
  const router = useRouter();
  const { online } = useNetworkStatus();
  const { activePatient } = useActiveProfile();
  const { doctorId, site } = useLocalSearchParams<{ doctorId: string; site?: string }>();
  const [doctor, setDoctor] = useState<Practitioner>();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [siteNames, setSiteNames] = useState<Record<string, string>>({});
  const [siteRef, setSiteRef] = useState<string | undefined>(site ? `Location/${site}` : undefined);
  const [services, setServices] = useState<HealthcareService[]>([]);
  const [serviceId, setServiceId] = useState<string>();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [booking, setBooking] = useState<string>();

  // Doctor + their per-site schedules.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const practitioner = await medplum.readResource('Practitioner', String(doctorId));
      setDoctor(practitioner);
      try {
        const found = await medplum.searchResources('Schedule', `actor=Practitioner/${doctorId}&active=true&_count=20`);
        setSchedules(found);
        // Resolve site names for the chips.
        const refs = Array.from(new Set(found.map(siteRefOf).filter((ref): ref is string => Boolean(ref))));
        const locations = await Promise.all(
          refs.map((ref) => medplum.readReference({ reference: ref } as { reference: string }).catch(() => undefined))
        );
        const names: Record<string, string> = {};
        refs.forEach((ref, i) => {
          const location = locations[i] as Location | undefined;
          names[ref] = location?.name ?? found.find((s) => siteRefOf(s) === ref)?.actor?.find((a) => a.reference === ref)?.display ?? 'Site';
        });
        setSiteNames(names);
        // With a single schedule there is nothing to choose.
        if (found.length === 1) {
          setSiteRef(siteRefOf(found[0]));
        }
      } catch {
        setSchedules([]);
      }
    } finally {
      setLoading(false);
    }
  }, [medplum, doctorId]);

  useEffect(() => {
    void load();
  }, [load]);

  const siteOptions = useMemo(
    () =>
      Array.from(new Set(schedules.map(siteRefOf).filter((ref): ref is string => Boolean(ref)))).map((ref) => ({
        ref,
        name: siteNames[ref] ?? 'Site',
      })),
    [schedules, siteNames]
  );

  // The schedule for the chosen site (or the only one).
  const schedule = useMemo(() => {
    if (schedules.length === 0) {
      return undefined;
    }
    if (siteRef) {
      return schedules.find((s) => siteRefOf(s) === siteRef);
    }
    return schedules.length === 1 ? schedules[0] : undefined;
  }, [schedules, siteRef]);

  // Services bookable on that schedule.
  useEffect(() => {
    if (!schedule) {
      setServices([]);
      setServiceId(undefined);
      return;
    }
    let active = true;
    Promise.all(
      serviceRefsOf(schedule).map((ref) =>
        medplum.readReference({ reference: ref } as { reference: string }).catch(() => undefined)
      )
    )
      .then((found) => {
        if (!active) {
          return;
        }
        const list = found.filter(
          (s): s is WithId<HealthcareService> => s?.resourceType === 'HealthcareService'
        );
        setServices(list);
        setServiceId((current) => (current && list.some((s) => s.id === current) ? current : list[0]?.id));
      })
      .catch(() => active && setServices([]));
    return () => {
      active = false;
    };
  }, [medplum, schedule]);

  // Live availability via Schedule/$find (falls back to published free Slots).
  useEffect(() => {
    if (!schedule?.id) {
      setSlots([]);
      return;
    }
    let active = true;
    setSlotsLoading(true);
    const start = new Date(Date.now() + MIN_NOTICE_MS);
    const end = new Date(start.getTime() + FIND_WINDOW_DAYS * 86_400_000);
    const find = async (): Promise<Slot[]> => {
      if (!serviceId) {
        throw new Error('no service');
      }
      const params = new URLSearchParams({
        start: start.toISOString(),
        end: end.toISOString(),
        'service-type-reference': `HealthcareService/${serviceId}`,
        _count: String(MAX_SLOTS),
      });
      const bundle = await medplum.get<Bundle<Slot>>(`fhir/R4/Schedule/${schedule.id}/$find?${params}`);
      return (bundle.entry ?? []).map((e) => e.resource).filter((s): s is Slot => Boolean(s));
    };
    const fallback = (): Promise<Slot[]> =>
      medplum.searchResources(
        'Slot',
        `schedule=Schedule/${schedule.id}&status=free&start=ge${start.toISOString()}&_sort=start&_count=${MAX_SLOTS}`
      );
    find()
      .catch(fallback)
      .then((found) => active && setSlots(found))
      .catch(() => active && setSlots([]))
      .finally(() => active && setSlotsLoading(false));
    return () => {
      active = false;
    };
  }, [medplum, schedule, serviceId]);

  async function book(slot?: Slot): Promise<void> {
    if (!activePatient?.id || !doctor?.id) {
      return;
    }
    // New-patient requests default to the agreed 30 minutes; a chosen slot keeps
    // its own published duration.
    const start = slot?.start ?? new Date(Date.now() + 86_400_000).toISOString();
    const end = slot?.end ?? new Date(Date.now() + 86_400_000 + 1_800_000).toISOString();
    const idempotencyKey = `book-${activePatient.id}-${doctor.id}-${start}`;
    const locationRef = siteRef ?? (schedule ? siteRefOf(schedule) : undefined);
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
      ...(slot?.serviceType ? { serviceType: slot.serviceType } : {}),
      start,
      end,
      slot: slot?.id ? [{ reference: `Slot/${slot.id}` }] : undefined,
      participant: [
        { actor: { reference: `Patient/${activePatient.id}` }, status: 'accepted' },
        { actor: { reference: `Practitioner/${doctor.id}` }, status: 'needs-action' },
        ...(locationRef ? [{ actor: { reference: locationRef }, status: 'accepted' as const }] : []),
      ],
    };
    setBooking(slot ? `${slot.id ?? slot.start}` : 'request');
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
        online ? (slot ? 'Appointment booked' : 'Appointment requested') : 'Saved offline',
        online
          ? slot
            ? 'You will receive a confirmation by WhatsApp or email.'
            : 'Your request was sent. You will be notified when it is confirmed.'
          : 'It will be sent automatically when you reconnect.'
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

  const chip = (selected: boolean): string => `px-3 py-1.5 rounded-pill ${selected ? 'bg-phc-orange/15' : 'bg-surface-card'}`;
  const chipText = (selected: boolean): string => `text-sm font-semibold ${selected ? 'text-phc-orange' : 'text-ink-secondary'}`;

  return (
    <Screen edges={[]}>
      <Card className="mt-2 items-center">
        <Avatar initials={patientInitials(doctor as never)} size={72} />
        <Text className="text-ink text-xl font-bold mt-3">{formatHumanName(doctor?.name)}</Text>
        <Text className="text-ink-secondary text-sm">{doctor?.qualification?.[0]?.code?.text ?? 'Practitioner'}</Text>
      </Card>

      {siteOptions.length > 1 ? (
        <>
          <Text className="text-ink text-lg font-bold mt-2">Site</Text>
          <View className="flex-row flex-wrap gap-2">
            {siteOptions.map((option) => (
              <Pressable key={option.ref} onPress={() => setSiteRef(option.ref)} className={chip(siteRef === option.ref)}>
                <Text className={chipText(siteRef === option.ref)}>{option.name}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : siteOptions.length === 1 ? (
        <Text className="text-ink-secondary text-sm mt-2">{siteOptions[0].name}</Text>
      ) : null}

      {services.length > 1 ? (
        <>
          <Text className="text-ink text-lg font-bold mt-2">Service</Text>
          <View className="flex-row flex-wrap gap-2">
            {services.map((service) => (
              <Pressable key={service.id} onPress={() => setServiceId(service.id)} className={chip(serviceId === service.id)}>
                <Text className={chipText(serviceId === service.id)}>{service.name ?? service.type?.[0]?.text ?? 'Service'}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      <Text className="text-ink text-lg font-bold mt-2">Available times</Text>
      {!schedule && siteOptions.length > 1 ? (
        <Text className="text-ink-secondary text-sm">Choose a site to see available times.</Text>
      ) : slotsLoading ? (
        <Loading />
      ) : slots.length > 0 ? (
        <View className="flex-row flex-wrap gap-2">
          {slots.map((s) => {
            const key = `${s.id ?? s.start}`;
            return (
              <Pressable
                key={key}
                onPress={() => book(s)}
                className={`px-3.5 py-2.5 rounded-field bg-surface-card ${booking === key ? 'opacity-50' : ''}`}
              >
                <Text className="text-ink text-sm font-medium">{formatSlot(s.start)}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Text className="text-ink-secondary text-sm">
          No available times in the next {FIND_WINDOW_DAYS} days. You can still request an appointment.
        </Text>
      )}

      <Button label="Request appointment" onPress={() => book()} loading={booking === 'request'} className="mt-2" />
    </Screen>
  );
}
