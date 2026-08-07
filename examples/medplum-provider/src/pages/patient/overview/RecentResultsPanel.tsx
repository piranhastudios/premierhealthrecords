// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Anchor, Badge, Center, Group, Loader, Stack, Text, UnstyledButton } from '@mantine/core';
import { formatDate } from '@medplum/core';
import type { DiagnosticReport } from '@medplum/fhirtypes';
import { CodeableConceptDisplay } from '@medplum/react';
import type { JSX, ReactNode } from 'react';
import { Link } from 'react-router';
import { DashboardPanel } from '../../dashboard/components/DashboardPanel';
import classes from './overview.module.css';

export interface RecentResultsPanelProps {
  readonly patientId: string;
  readonly reports: DiagnosticReport[] | undefined;
  readonly loading: boolean;
}

/**
 * The patient's most recent diagnostic reports, newest first.
 *
 * @param props - The patient id, their reports, and a loading flag.
 * @returns The results panel.
 */
export function RecentResultsPanel(props: RecentResultsPanelProps): JSX.Element {
  const { patientId, reports, loading } = props;

  let body: ReactNode;
  if (loading) {
    body = (
      <Center h="100%">
        <Loader />
      </Center>
    );
  } else if (!reports?.length) {
    body = (
      <Text size="sm" c="dimmed">
        No results on file.
      </Text>
    );
  } else {
    body = (
      <Stack gap="xs">
        {reports.map((report) => (
          <UnstyledButton
            key={report.id}
            component={Link}
            to={`/Patient/${patientId}/DiagnosticReport/${report.id}`}
            className={classes.row}
          >
            <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
              <div style={{ minWidth: 0 }}>
                <Text size="sm" lineClamp={1}>
                  {report.code ? <CodeableConceptDisplay value={report.code} /> : 'Report'}
                </Text>
                <Text size="xs" c="dark.2">
                  {formatDate(report.effectiveDateTime ?? report.issued ?? report.meta?.lastUpdated)}
                </Text>
              </div>
              {report.status && (
                <Badge size="sm" variant="light" color={report.status === 'final' ? 'green' : 'gray'}>
                  {report.status}
                </Badge>
              )}
            </Group>
          </UnstyledButton>
        ))}
      </Stack>
    );
  }

  return (
    <DashboardPanel
      title="Recent Results"
      subtitle="Latest diagnostic reports"
      action={
        <Anchor component={Link} to={`/Patient/${patientId}/ServiceRequest`} size="xs">
          All labs
        </Anchor>
      }
    >
      {body}
    </DashboardPanel>
  );
}
