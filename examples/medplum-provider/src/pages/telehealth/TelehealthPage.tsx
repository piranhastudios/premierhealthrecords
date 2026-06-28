// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Center, Text } from '@mantine/core';
import type { JSX } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { VideoVisitFullscreen } from '../../components/telehealth/VideoVisitFullscreen';

/**
 * Standalone, full-screen telemedicine page (Google-Meet-style, responsive for
 * desktop and mobile). The room is the Appointment/Encounter id; the patient
 * opens `/telehealth/:id` from a shared link (no account needed). Append
 * `?audioOnly=1` for a voice-only call on a constrained connection.
 */
export function TelehealthPage(): JSX.Element {
  const { appointmentId } = useParams();
  const [searchParams] = useSearchParams();
  const audioOnly = searchParams.get('audioOnly') === '1';

  if (!appointmentId) {
    return (
      <Center style={{ minHeight: '100vh' }}>
        <Text c="dimmed">This visit link is invalid.</Text>
      </Center>
    );
  }

  return <VideoVisitFullscreen roomId={appointmentId} audioOnly={audioOnly} />;
}
