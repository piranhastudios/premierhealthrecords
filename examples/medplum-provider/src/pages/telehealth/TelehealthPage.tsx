// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Center, Paper, Stack, Text } from '@mantine/core';
import type { JSX } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { VideoVisit } from '../../components/telehealth/VideoVisit';

/**
 * Standalone, chrome-free telemedicine page. The room is the Appointment/Encounter
 * id; the patient opens `/telehealth/:id` from a shared link (no account needed)
 * and the clinician joins from the encounter. Append `?audioOnly=1` for a
 * voice-only call on a constrained connection.
 */
export function TelehealthPage(): JSX.Element {
  const { appointmentId } = useParams();
  const [searchParams] = useSearchParams();
  const audioOnly = searchParams.get('audioOnly') === '1';

  return (
    <Center style={{ minHeight: '100vh', background: 'var(--mantine-color-gray-1)', padding: 16 }}>
      <Paper withBorder shadow="md" radius="md" p="lg" w="100%" maw={460}>
        <Stack gap="md">
          <Text fw={700} size="lg">
            Premier Health — Video Visit
          </Text>
          {appointmentId ? (
            <VideoVisit roomId={appointmentId} audioOnly={audioOnly} />
          ) : (
            <Text c="dimmed">This visit link is invalid.</Text>
          )}
        </Stack>
      </Paper>
    </Center>
  );
}
