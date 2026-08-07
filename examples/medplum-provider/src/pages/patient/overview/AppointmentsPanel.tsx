// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Anchor, Center, Divider, Group, Loader, Stack, Text, UnstyledButton } from '@mantine/core';
import type { Appointment } from '@medplum/fhirtypes';
import type { JSX } from 'react';
import { Link } from 'react-router';
import { DashboardPanel } from '../../dashboard/components/DashboardPanel';
import { statusColor, statusLabel } from '../../dashboard/components/appointmentStatus';
import { AppointmentCard, relativeDayLabel } from './AppointmentCard';
import classes from './overview.module.css';

export interface AppointmentsPanelProps {
  readonly patientId: string;
  readonly upcoming: Appointment[] | undefined;
  readonly past: Appointment[] | undefined;
  readonly loading: boolean;
}

/**
 * The patient's appointments at a glance: a detail card for the next one, a
 * compact list of the ones after it, and the most recent past visit for context.
 *
 * @param props - The patient id, their upcoming/past appointments, and a loading flag.
 * @returns The appointments panel.
 */
export function AppointmentsPanel(props: AppointmentsPanelProps): JSX.Element {
  const { patientId, upcoming, past, loading } = props;
  const [next, ...later] = upcoming ?? [];
  const lastVisit = past?.[0];

  return (
    <DashboardPanel
      title="Appointments"
      subtitle={next ? 'Next appointment' : 'No upcoming appointments'}
      action={
        <Anchor component={Link} to="/Calendar/Schedule" size="xs">
          Schedule
        </Anchor>
      }
    >
      {loading ? (
        <Center h="100%">
          <Loader />
        </Center>
      ) : (
        <Stack gap="sm">
          {next ? (
            <AppointmentCard appointment={next} patientId={patientId} featured />
          ) : (
            <Text size="sm" c="dimmed">
              Nothing is booked for this patient.
            </Text>
          )}

          {later.length > 0 && (
            <>
              <Divider label="Later" labelPosition="left" />
              <Stack gap={6}>
                {later.map((appt) => (
                  <AppointmentRow key={appt.id} appointment={appt} patientId={patientId} />
                ))}
              </Stack>
            </>
          )}

          {lastVisit && (
            <>
              <Divider label="Last visit" labelPosition="left" />
              <AppointmentRow appointment={lastVisit} patientId={patientId} />
            </>
          )}
        </Stack>
      )}
    </DashboardPanel>
  );
}

interface AppointmentRowProps {
  readonly appointment: Appointment;
  readonly patientId: string;
}

/**
 * One-line summary of an appointment, linking to its detail page.
 *
 * @param props - Row inputs.
 * @param props.appointment - The appointment to summarise.
 * @param props.patientId - The patient the appointment belongs to.
 * @returns The row.
 */
function AppointmentRow({ appointment, patientId }: AppointmentRowProps): JSX.Element {
  const start = appointment.start ? new Date(appointment.start) : undefined;
  return (
    <UnstyledButton component={Link} to={`/Patient/${patientId}/Appointment/${appointment.id}`} className={classes.row}>
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Text size="sm" lineClamp={1}>
          {start ? relativeDayLabel(start) : 'Date not set'}
          {start && (
            <Text span size="sm" c="dark.2">
              {' · '}
              {start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </Text>
          )}
        </Text>
        <Text size="xs" c={statusColor(appointment.status)} style={{ flexShrink: 0 }}>
          {statusLabel(appointment.status)}
        </Text>
      </Group>
    </UnstyledButton>
  );
}
