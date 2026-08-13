// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Anchor, Badge, Button, Center, Group, Loader, ScrollArea, Stack, Text } from '@mantine/core';
import { getDisplayString } from '@medplum/core';
import type { Appointment, Observation, Patient } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { IconCalendarOff, IconHeartbeat, IconLogin2 } from '@tabler/icons-react';
import type { JSX, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { startOfToday } from '../../../hooks/useDashboardMetrics';
import { showErrorNotification } from '../../../utils/notifications';
import { DashboardPanel, PanelEmptyState } from './DashboardPanel';
import { RecordVitalsModal } from './RecordVitalsModal';
import classes from './TasksList.module.css';

export type StationMode = 'nurse' | 'front-desk';

/** Where a visit sits in the booked → arrived → vitals → doctor → done flow. */
type Stage = 'expected' | 'waiting' | 'ready' | 'with-doctor' | 'done';

interface StageMeta {
  label: string;
  color: string;
  order: number;
}

/** Stage presentation. The nurse works the queue top-down: vitals first. */
const STAGES: Record<Stage, StageMeta> = {
  waiting: { label: 'Waiting for vitals', color: '#fdb913', order: 0 },
  expected: { label: 'Expected', color: '#adb5bd', order: 1 },
  ready: { label: 'Ready for doctor', color: '#1f9d55', order: 2 },
  'with-doctor': { label: 'With doctor', color: '#f47b20', order: 3 },
  done: { label: 'Completed', color: '#868e96', order: 4 },
};

/** Front desk copy: an arrived patient is simply at the nurses station. */
const FRONT_DESK_LABELS: Partial<Record<Stage, string>> = {
  waiting: 'At nurses station',
};

/** Statuses that don't belong in a working queue. */
const EXCLUDED_STATUSES = new Set(['cancelled', 'entered-in-error', 'noshow', 'waitlist']);

/**
 * LOINC codes that count as station vitals: BP panel, heart rate, temperature,
 * respiratory rate, SpO2. Deliberately excludes height/weight/BMI — the
 * registration flow writes those, and they must not make an arrived patient
 * look like the nurse has already seen them.
 */
const STATION_VITAL_CODES = ['85354-9', '55284-4', '8867-4', '8310-5', '9279-1', '2708-6', '59408-5'];

/**
 * Virtual/video visits never pass through the physical check-in → vitals flow,
 * so they stay off both station queues. Matches the same appointmentType coding
 * the patient portal uses to detect video visits (see APPOINTMENT_TYPES).
 * @param appointment - The appointment to test.
 * @returns True for virtual/telehealth appointments.
 */
function isVirtual(appointment: Appointment): boolean {
  return (appointment.appointmentType?.coding ?? []).some((coding) =>
    /telehealth|video|virtual/i.test(`${coding.code ?? ''} ${coding.display ?? ''}`)
  );
}

interface Row {
  id: string;
  time: string;
  start: number;
  patientRef: string | undefined;
  patientName: string;
  stage: Stage;
}

/**
 * Patient participant of an appointment, if any. Portal-booked appointments
 * often omit the participant display, so `names` (resolved from the Patient
 * resources) fills the gap.
 * @param appointment - The appointment to read participants from.
 * @param names - Resolved names by patient reference, for participants without a display.
 * @returns The patient's reference and display name.
 */
function patientOf(appointment: Appointment, names: Map<string, string>): { ref: string | undefined; name: string } {
  const actor = appointment.participant?.find((p) => p.actor?.reference?.startsWith('Patient/'))?.actor;
  const name = actor?.display ?? (actor?.reference && names.get(actor.reference)) ?? 'Unknown patient';
  return { ref: actor?.reference, name };
}

/**
 * Derives the queue stage for an appointment.
 * @param appointment - The appointment.
 * @param hasVitalsToday - Whether vitals were recorded today for its patient.
 * @returns The stage, or undefined for statuses excluded from the queue.
 */
function stageOf(appointment: Appointment, hasVitalsToday: boolean): Stage | undefined {
  const status = appointment.status ?? 'booked';
  if (EXCLUDED_STATUSES.has(status)) {
    return undefined;
  }
  switch (status) {
    case 'arrived':
      return hasVitalsToday ? 'ready' : 'waiting';
    case 'checked-in':
      return 'with-doctor';
    case 'fulfilled':
      return 'done';
    default:
      // booked / proposed / pending — not here yet.
      return 'expected';
  }
}

export interface StationQueueProps {
  /** Which station this queue serves — decides the row action. */
  mode: StationMode;
  /** Today's appointments, shared with the status donut (single fetch). */
  appointments: Appointment[] | undefined;
  loading: boolean;
  /** Refetches the shared appointment data after a status change. */
  onRefresh: () => void;
  /** Called after vitals are saved (nurse mode) so KPI tiles can refresh. */
  onVitalsRecorded?: () => void;
  /** Bump to refetch the vitals lookup (live Observation events). */
  refreshKey?: number;
  bodyHeight?: number;
}

/**
 * The station queue — today's visits as a work queue for the check-in →
 * vitals → doctor flow. Front desk marks booked patients as arrived; the
 * nurse records vitals for arrived patients, which advances the row to
 * "Ready for doctor". Rows link to the patient chart.
 *
 * @param props - Mode, shared appointment data, and refresh callbacks.
 * @returns The station queue panel.
 */
export function StationQueue(props: StationQueueProps): JSX.Element {
  const { mode, appointments, loading, onRefresh, onVitalsRecorded, refreshKey = 0, bodyHeight = 460 } = props;
  const medplum = useMedplum();
  const [vitalsPatients, setVitalsPatients] = useState<Set<string> | undefined>(mode === 'nurse' ? undefined : new Set());
  const [vitalsTick, setVitalsTick] = useState(0);
  const [checkingInId, setCheckingInId] = useState<string | undefined>(undefined);
  const [vitalsTarget, setVitalsTarget] = useState<Row | undefined>(undefined);
  const [patientNames, setPatientNames] = useState<Map<string, string>>(new Map());

  // Resolve names for participants without a display (portal-booked visits).
  useEffect(() => {
    const missing = (appointments ?? [])
      .map((appt) => appt.participant?.find((p) => p.actor?.reference?.startsWith('Patient/'))?.actor)
      .filter((actor) => actor?.reference && !actor.display)
      .map((actor) => (actor?.reference as string).split('/')[1]);
    if (missing.length === 0) {
      return () => {};
    }
    let active = true;
    medplum
      .searchResources('Patient', [
        ['_id', Array.from(new Set(missing)).join(',')],
        ['_fields', 'name'],
      ])
      .then((patients: Patient[]) => {
        if (active) {
          setPatientNames(new Map(patients.map((p) => [`Patient/${p.id}`, getDisplayString(p)])));
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [medplum, appointments]);

  // Nurse mode: which patients already have station vitals recorded today. This
  // is what drops an arrived patient off the "waiting for vitals" queue. Only
  // core station measurements count (see STATION_VITAL_CODES) — registration's
  // height/weight/BMI readings don't.
  useEffect(() => {
    if (mode !== 'nurse') {
      return () => {};
    }
    let active = true;
    medplum
      .searchResources('Observation', [
        ['code', STATION_VITAL_CODES.join(',')],
        ['date', `ge${startOfToday()}`],
        ['_count', '500'],
        ['_fields', 'subject'],
      ])
      .then((observations: Observation[]) => {
        if (active) {
          setVitalsPatients(new Set(observations.map((obs) => obs.subject?.reference).filter(Boolean) as string[]));
        }
      })
      .catch(() => active && setVitalsPatients(new Set()));
    return () => {
      active = false;
    };
  }, [medplum, mode, vitalsTick, refreshKey, appointments]);

  const handleCheckIn = async (appointmentId: string): Promise<void> => {
    const appointment = (appointments ?? []).find((a) => a.id === appointmentId);
    if (!appointment) {
      return;
    }
    setCheckingInId(appointmentId);
    try {
      await medplum.updateResource<Appointment>({ ...appointment, status: 'arrived' });
      onRefresh();
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setCheckingInId(undefined);
    }
  };

  const handleVitalsRecorded = (): void => {
    setVitalsTick((t) => t + 1);
    onVitalsRecorded?.();
  };

  const rows: Row[] = (appointments ?? [])
    .flatMap((appointment) => {
      if (isVirtual(appointment)) {
        return [];
      }
      const patient = patientOf(appointment, patientNames);
      const stage = stageOf(appointment, Boolean(patient.ref && vitalsPatients?.has(patient.ref)));
      if (!stage) {
        return [];
      }
      // The nurse's queue is strictly the work in front of them: patients who
      // have arrived and still need vitals. Everyone else (not yet arrived,
      // already with the doctor, done) stays off it.
      if (mode === 'nurse' && stage !== 'waiting') {
        return [];
      }
      const start = appointment.start ? new Date(appointment.start).getTime() : 0;
      return [
        {
          id: appointment.id ?? '',
          time: appointment.start
            ? new Date(appointment.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : '—',
          start,
          patientRef: patient.ref,
          patientName: patient.name,
          stage,
        },
      ];
    })
    .sort((a, b) => STAGES[a.stage].order - STAGES[b.stage].order || a.start - b.start);

  const waitingCount = rows.filter((r) => r.stage === 'waiting').length;

  let body: ReactNode;
  if (loading || (mode === 'nurse' && vitalsPatients === undefined)) {
    body = (
      <Center h="100%">
        <Loader />
      </Center>
    );
  } else if (rows.length === 0) {
    body =
      mode === 'front-desk' ? (
        <PanelEmptyState
          icon={<IconCalendarOff size={22} />}
          label="No visits today"
          hint="Booked patients will appear here for check-in"
        />
      ) : (
        <PanelEmptyState
          icon={<IconHeartbeat size={22} />}
          label="No patients waiting"
          hint="Patients appear here when front desk checks them in"
        />
      );
  } else {
    body = (
      <ScrollArea h="100%" type="auto">
        <Stack gap={0}>
          {rows.map((row) => (
            <Group key={row.id} className={classes.row} wrap="nowrap" gap="sm">
              <Text size="sm" fw={600} w={56} c={row.stage === 'done' ? 'dimmed' : undefined} style={{ flexShrink: 0 }}>
                {row.time}
              </Text>
              <div className={classes.main}>
                <Anchor
                  component={Link}
                  to={row.patientRef ? `/${row.patientRef}` : `/Appointment/${row.id}`}
                  size="sm"
                  fw={500}
                  c={row.stage === 'done' ? 'dimmed' : undefined}
                  lineClamp={1}
                >
                  {row.patientName}
                </Anchor>
              </div>
              {mode === 'front-desk' && (
                <Badge variant="light" color={STAGES[row.stage].color} size="sm" style={{ flexShrink: 0 }}>
                  {FRONT_DESK_LABELS[row.stage] ?? STAGES[row.stage].label}
                </Badge>
              )}
              {mode === 'front-desk' && row.stage === 'expected' && (
                <Button
                  size="xs"
                  color="brand"
                  leftSection={<IconLogin2 size={14} />}
                  loading={checkingInId === row.id}
                  onClick={() => handleCheckIn(row.id)}
                >
                  Check in
                </Button>
              )}
              {mode === 'nurse' && row.stage === 'waiting' && (
                <Button
                  size="xs"
                  color="brand"
                  leftSection={<IconHeartbeat size={14} />}
                  onClick={() => setVitalsTarget(row)}
                >
                  Record vitals
                </Button>
              )}
            </Group>
          ))}
        </Stack>
      </ScrollArea>
    );
  }

  const title = mode === 'nurse' ? 'Nurses Station' : 'Check-in';
  let subtitle = 'Mark patients as arrived when they come in';
  if (mode === 'nurse') {
    subtitle =
      waitingCount > 0
        ? `${waitingCount} patient${waitingCount === 1 ? '' : 's'} waiting for vitals`
        : 'Arrived patients queue here for vitals';
  }

  return (
    <>
      <DashboardPanel
        title={title}
        subtitle={subtitle}
        action={
          <Anchor component={Link} to="/Calendar/Schedule" size="sm">
            Open schedule
          </Anchor>
        }
        bodyHeight={bodyHeight}
      >
        {body}
      </DashboardPanel>
      <RecordVitalsModal
        opened={vitalsTarget !== undefined}
        onClose={() => setVitalsTarget(undefined)}
        patientRef={vitalsTarget?.patientRef}
        patientName={vitalsTarget?.patientName}
        appointmentId={vitalsTarget?.id}
        onRecorded={handleVitalsRecorded}
      />
    </>
  );
}
