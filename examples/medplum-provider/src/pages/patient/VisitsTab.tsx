// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Anchor, Badge, Group, Loader, Center, Stack, Table, Text } from '@mantine/core';
import type { Appointment, Encounter } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { IconCalendarOff } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ChartTablePanel } from '../../components/tables/ChartTablePanel';
import { showErrorNotification } from '../../utils/notifications';

/** A visit, whether it has happened yet or not. */
interface VisitRow {
  key: string;
  /** Sort key — ms since epoch, 0 when the record carries no date at all. */
  when: number;
  date?: string;
  label: string;
  status?: string;
  /** Where clicking the row goes. */
  href: string;
  /** Scheduled appointments and completed encounters read very differently. */
  kind: 'Scheduled' | 'Visit';
  practitioner?: string;
}

function coded(value: { text?: string; coding?: { display?: string; code?: string }[] } | undefined): string | undefined {
  return value?.text ?? value?.coding?.[0]?.display ?? value?.coding?.[0]?.code;
}

function actorName(
  participants: { actor?: { reference?: string; display?: string } }[] | undefined,
  prefix: string
): string | undefined {
  return participants?.find((p) => p.actor?.reference?.startsWith(prefix))?.actor?.display;
}

function encounterRow(encounter: Encounter, patientId: string): VisitRow {
  const date = encounter.period?.start;
  return {
    key: `Encounter/${encounter.id}`,
    when: date ? new Date(date).getTime() : 0,
    date,
    label: coded(encounter.type?.[0]) ?? encounter.class?.display ?? 'Visit',
    status: encounter.status,
    href: `/Patient/${patientId}/Encounter/${encounter.id}`,
    kind: 'Visit',
    practitioner: actorName(encounter.participant as never, 'Practitioner'),
  };
}

function appointmentRow(appointment: Appointment, patientId: string): VisitRow {
  const date = appointment.start;
  return {
    key: `Appointment/${appointment.id}`,
    when: date ? new Date(date).getTime() : 0,
    date,
    label: coded(appointment.appointmentType) ?? coded(appointment.serviceType?.[0]) ?? 'Appointment',
    status: appointment.status,
    href: `/Patient/${patientId}/Appointment/${appointment.id}`,
    kind: 'Scheduled',
    practitioner: actorName(appointment.participant, 'Practitioner'),
  };
}

/**
 * The patient chart's Visits tab.
 *
 * Previously this listed Encounters only, so an appointment — including every
 * visit booked from the patient portal or the website — was invisible here
 * until someone opened an encounter for it. Staff had no way to see a patient's
 * booked visits from the chart.
 *
 * Now both are listed on one timeline. An appointment that already has an
 * encounter is shown ONCE, as the encounter: `Encounter.appointment` links the
 * two, and listing both would double-count the same visit.
 * @returns The Visits tab.
 */
export function VisitsTab(): JSX.Element {
  const medplum = useMedplum();
  const { patientId } = useParams();
  const [rows, setRows] = useState<VisitRow[]>();

  const load = useCallback(async () => {
    if (!patientId) {
      return;
    }
    try {
      const [encounters, appointments] = await Promise.all([
        medplum.searchResources('Encounter', `patient=Patient/${patientId}&_count=100&_sort=-_lastUpdated`),
        medplum.searchResources('Appointment', `patient=Patient/${patientId}&_count=100&_sort=-date`),
      ]);

      // An encounter created from an appointment references it. Those
      // appointments are the same visit, so keep only the encounter.
      const covered = new Set<string>();
      for (const encounter of encounters) {
        for (const ref of encounter.appointment ?? []) {
          if (ref.reference) {
            covered.add(ref.reference);
          }
        }
      }

      const merged: VisitRow[] = [
        ...encounters.map((e) => encounterRow(e, patientId)),
        ...appointments
          .filter((a) => !covered.has(`Appointment/${a.id}`))
          .map((a) => appointmentRow(a, patientId)),
      ];

      // Most recent first, and undated records last rather than floating to the
      // top — the server emits no NULLS LAST, so this is done here.
      merged.sort((a, b) => b.when - a.when);
      setRows(merged);
    } catch (err) {
      showErrorNotification(err);
      setRows([]);
    }
  }, [medplum, patientId]);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  if (!rows) {
    return (
      <ChartTablePanel title="Visits" fill>
        <Center p="xl">
          <Loader />
        </Center>
      </ChartTablePanel>
    );
  }

  return (
    <ChartTablePanel title="Visits" total={rows.length} fill>
      {rows.length === 0 ? (
        <Center p="xl">
          <Stack align="center" gap={4}>
            <IconCalendarOff size={28} opacity={0.5} />
            <Text c="dimmed">No visits or appointments yet</Text>
          </Stack>
        </Center>
      ) : (
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Date</Table.Th>
              <Table.Th>Type</Table.Th>
              <Table.Th>Practitioner</Table.Th>
              <Table.Th>Status</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row) => (
              <Table.Tr key={row.key}>
                <Table.Td>
                  <Anchor component={Link} to={row.href}>
                    {row.date ? new Date(row.date).toLocaleString() : '—'}
                  </Anchor>
                </Table.Td>
                <Table.Td>
                  <Group gap="xs">
                    <Text size="sm">{row.label}</Text>
                    <Badge size="xs" variant="light" color={row.kind === 'Scheduled' ? 'blue' : 'gray'}>
                      {row.kind}
                    </Badge>
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c="dimmed">
                    {row.practitioner ?? '—'}
                  </Text>
                </Table.Td>
                <Table.Td>{row.status ? <Badge variant="light">{row.status}</Badge> : null}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </ChartTablePanel>
  );
}
