// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Badge, Button, Card, Group, Stack, Text } from '@mantine/core';
import type { Appointment } from '@medplum/fhirtypes';
import { CodeableConceptDisplay, ResourceName } from '@medplum/react';
import { IconCalendarEvent, IconClock, IconMapPin, IconStethoscope } from '@tabler/icons-react';
import type { JSX, ReactNode } from 'react';
import { Link } from 'react-router';
import { statusColor, statusLabel } from '../../dashboard/components/appointmentStatus';

/** Actor reference types that identify the clinician on an appointment. */
const PRACTITIONER_TYPES = ['Practitioner', 'PractitionerRole', 'RelatedPerson'];

/**
 * Formats the day of an appointment relative to today.
 *
 * @param date - The appointment start.
 * @returns `Today`, `Tomorrow`, `Yesterday`, or a full date.
 */
export function relativeDayLabel(date: Date): string {
  const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(date) - startOfDay(new Date())) / 86_400_000);
  if (days === 0) {
    return 'Today';
  }
  if (days === 1) {
    return 'Tomorrow';
  }
  if (days === -1) {
    return 'Yesterday';
  }
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Formats the time window of an appointment, e.g. `09:00 – 09:30 (30 min)`.
 *
 * @param appointment - The appointment.
 * @returns The formatted window, or undefined when there is no start.
 */
function timeWindow(appointment: Appointment): string | undefined {
  if (!appointment.start) {
    return undefined;
  }
  const time = (value: string): string =>
    new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const start = time(appointment.start);
  if (!appointment.end) {
    return start;
  }
  const minutes =
    appointment.minutesDuration ??
    Math.round((new Date(appointment.end).getTime() - new Date(appointment.start).getTime()) / 60_000);
  return `${start} – ${time(appointment.end)}${minutes > 0 ? ` (${minutes} min)` : ''}`;
}

interface DetailRowProps {
  icon: ReactNode;
  children: ReactNode;
}

/**
 * One icon + text line inside the appointment card.
 *
 * @param props - Row inputs.
 * @param props.icon - The leading icon.
 * @param props.children - The row text.
 * @returns The detail row.
 */
function DetailRow({ icon, children }: DetailRowProps): JSX.Element {
  return (
    <Group gap="xs" wrap="nowrap" align="center">
      <span style={{ color: 'var(--mantine-color-dark-2)', display: 'flex' }} aria-hidden>
        {icon}
      </span>
      <Text size="sm" style={{ minWidth: 0 }} lineClamp={1}>
        {children}
      </Text>
    </Group>
  );
}

export interface AppointmentCardProps {
  readonly appointment: Appointment;
  readonly patientId: string;
  /** Highlighted styling and visit actions for the patient's next appointment. */
  readonly featured?: boolean;
}

/**
 * Renders the details of a single appointment: when it is, what it's for, who
 * the patient is seeing, and where. The featured variant is used for the next
 * upcoming appointment and offers to start the visit.
 *
 * @param props - The appointment, its patient, and the display variant.
 * @returns The appointment card.
 */
export function AppointmentCard(props: AppointmentCardProps): JSX.Element {
  const { appointment, patientId, featured } = props;
  const start = appointment.start ? new Date(appointment.start) : undefined;
  const actors = (appointment.participant ?? [])
    .map((p) => p.actor)
    .filter((actor): actor is NonNullable<typeof actor> => !!actor?.reference);
  const practitioners = actors.filter((actor) => PRACTITIONER_TYPES.includes(actor.reference?.split('/')[0] ?? ''));
  const location = actors.find((actor) => actor.reference?.startsWith('Location/'));
  const serviceType = appointment.serviceType?.[0] ?? appointment.appointmentType;
  const window = timeWindow(appointment);

  return (
    <Card
      withBorder
      radius="lg"
      p="md"
      bg={featured ? 'dark.6' : 'dark.7'}
      style={{ borderColor: featured ? 'var(--mantine-color-brand-6)' : 'var(--mantine-color-dark-4)' }}
    >
      <Stack gap="xs">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <div style={{ minWidth: 0 }}>
            <Text fw={700} size={featured ? 'xl' : 'md'} lh={1.2}>
              {start ? relativeDayLabel(start) : 'Date not set'}
            </Text>
            {window && (
              <Text size="sm" c="dark.1">
                {window}
              </Text>
            )}
          </div>
          <Badge variant="light" color="gray" styles={{ root: { color: statusColor(appointment.status) } }}>
            {statusLabel(appointment.status)}
          </Badge>
        </Group>

        {serviceType && (
          <DetailRow icon={<IconCalendarEvent size={16} />}>
            <CodeableConceptDisplay value={serviceType} />
          </DetailRow>
        )}

        {practitioners.map((actor) => (
          <DetailRow key={actor.reference} icon={<IconStethoscope size={16} />}>
            <ResourceName value={actor} />
          </DetailRow>
        ))}

        {location && (
          <DetailRow icon={<IconMapPin size={16} />}>
            <ResourceName value={location} />
          </DetailRow>
        )}

        {(appointment.description ?? appointment.comment) && (
          <DetailRow icon={<IconClock size={16} />}>{appointment.description ?? appointment.comment}</DetailRow>
        )}

        <Group gap="xs" mt={4}>
          {featured && (
            <Button size="xs" component={Link} to={`/Patient/${patientId}/Encounter/new`}>
              Start visit
            </Button>
          )}
          <Button
            size="xs"
            variant={featured ? 'default' : 'subtle'}
            component={Link}
            to={`/Patient/${patientId}/Appointment/${appointment.id}`}
          >
            Details
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
