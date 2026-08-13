// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Loader } from '@mantine/core';
import { PatientTimeline } from '@medplum/react';
import type { JSX } from 'react';
import { Navigate } from 'react-router';
import { usePatient } from '../../hooks/usePatient';
import { useUserRole } from '../../hooks/useUserRole';

export function TimelineTab(): JSX.Element {
  const patient = usePatient();
  const { role } = useUserRole();
  if (!patient) {
    return <Loader />;
  }
  // The activity timeline is clinical — front desk is bounced to the chart root
  // (this route is only reachable by deep link for them; the button is hidden).
  if (role === 'front-desk') {
    return <Navigate to={`/Patient/${patient.id}`} replace />;
  }
  return <PatientTimeline patient={patient} />;
}
