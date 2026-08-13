// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Grid, Loader, Stack } from '@mantine/core';
import type { JSX } from 'react';
import { Navigate } from 'react-router';
import { usePatient } from '../../../hooks/usePatient';
import { useUserRole } from '../../../hooks/useUserRole';
import { formatPatientPageTabUrl, getPatientPageTabOrThrow } from '../PatientPage.utils';
import { AppointmentsPanel } from './AppointmentsPanel';
import { OpenTasksPanel } from './OpenTasksPanel';
import { RecentResultsPanel } from './RecentResultsPanel';
import { VitalsPanel } from './VitalsPanel';
import { useOpenTasks, usePatientAppointments, useRecentReports, useVitalsHistory } from './usePatientOverview';

/**
 * The patient's landing tab: what's scheduled, how their vitals are trending,
 * and what still needs attention. The full activity feed lives in the timeline
 * drawer rather than on this page.
 *
 * The overview is clinical — front desk has no Overview tab and lands on the
 * Visits tab instead.
 *
 * @returns The overview tab.
 */
export function OverviewTab(): JSX.Element {
  const patient = usePatient();
  const patientId = patient?.id;
  const { role } = useUserRole();
  const clinical = role !== 'front-desk';

  const vitals = useVitalsHistory(clinical ? patientId : undefined);
  const appointments = usePatientAppointments(clinical ? patientId : undefined);
  const reports = useRecentReports(clinical ? patientId : undefined);
  const tasks = useOpenTasks(clinical ? patientId : undefined);

  if (!patientId) {
    return <Loader m="md" />;
  }

  if (!clinical) {
    return <Navigate to={formatPatientPageTabUrl(patientId, getPatientPageTabOrThrow('encounter'))} replace />;
  }

  return (
    <Stack p="md" gap="md">
      <Grid gutter="md">
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <AppointmentsPanel
            patientId={patientId}
            upcoming={appointments.upcoming}
            past={appointments.past}
            loading={appointments.loading}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <VitalsPanel observations={vitals.data} loading={vitals.loading} />
        </Grid.Col>
      </Grid>

      <Grid gutter="md">
        <Grid.Col span={{ base: 12, md: 6 }}>
          <RecentResultsPanel patientId={patientId} reports={reports.data} loading={reports.loading} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <OpenTasksPanel patientId={patientId} tasks={tasks.data} loading={tasks.loading} />
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
