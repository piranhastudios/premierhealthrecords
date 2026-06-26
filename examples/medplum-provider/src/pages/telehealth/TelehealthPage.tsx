// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Document } from '@medplum/react';
import type { JSX } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { VideoVisit } from '../../components/telehealth/VideoVisit';

/**
 * Telemedicine visit page. The room is the Appointment id; both the consultant and
 * the patient open `/telehealth/:appointmentId` to join the same call. Append
 * `?audioOnly=1` to start without video on a constrained connection.
 */
export function TelehealthPage(): JSX.Element {
  const { appointmentId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const audioOnly = searchParams.get('audioOnly') === '1';

  if (!appointmentId) {
    return <Document>Missing appointment id.</Document>;
  }

  return (
    <Document width={900}>
      <VideoVisit roomId={appointmentId} audioOnly={audioOnly} onLeave={() => navigate(-1)} />
    </Document>
  );
}
