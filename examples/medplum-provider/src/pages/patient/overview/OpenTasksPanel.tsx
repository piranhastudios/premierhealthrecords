// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Anchor, Badge, Center, Group, Loader, Stack, Text, UnstyledButton } from '@mantine/core';
import { formatDate } from '@medplum/core';
import type { Task } from '@medplum/fhirtypes';
import { CodeableConceptDisplay } from '@medplum/react';
import type { JSX, ReactNode } from 'react';
import { Link } from 'react-router';
import { DashboardPanel } from '../../dashboard/components/DashboardPanel';
import classes from './overview.module.css';

/** Mantine color for each task priority. */
const PRIORITY_COLOR: Record<string, string> = {
  stat: 'brandRed',
  asap: 'brandRed',
  urgent: 'brandGold',
  routine: 'gray',
};

export interface OpenTasksPanelProps {
  readonly patientId: string;
  readonly tasks: Task[] | undefined;
  readonly loading: boolean;
}

/**
 * Tasks still open for this patient, most recently updated first.
 *
 * @param props - The patient id, their open tasks, and a loading flag.
 * @returns The tasks panel.
 */
export function OpenTasksPanel(props: OpenTasksPanelProps): JSX.Element {
  const { patientId, tasks, loading } = props;

  let body: ReactNode;
  if (loading) {
    body = (
      <Center h="100%">
        <Loader />
      </Center>
    );
  } else if (!tasks?.length) {
    body = (
      <Text size="sm" c="dimmed">
        Nothing outstanding.
      </Text>
    );
  } else {
    body = (
      <Stack gap="xs">
        {tasks.map((task) => {
          const due = task.restriction?.period?.end;
          return (
            <UnstyledButton
              key={task.id}
              component={Link}
              to={`/Patient/${patientId}/Task/${task.id}`}
              className={classes.row}
            >
              <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
                <div style={{ minWidth: 0 }}>
                  <Text size="sm" lineClamp={1}>
                    {task.code ? <CodeableConceptDisplay value={task.code} /> : (task.description ?? 'Task')}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {task.status}
                    {due ? ` · due ${formatDate(due)}` : ''}
                  </Text>
                </div>
                {task.priority && task.priority !== 'routine' && (
                  <Badge size="sm" variant="light" color={PRIORITY_COLOR[task.priority] ?? 'gray'}>
                    {task.priority}
                  </Badge>
                )}
              </Group>
            </UnstyledButton>
          );
        })}
      </Stack>
    );
  }

  return (
    <DashboardPanel
      title="Open Tasks"
      subtitle="Awaiting action"
      action={
        <Anchor component={Link} to={`/Patient/${patientId}/Task`} size="xs">
          All tasks
        </Anchor>
      }
    >
      {body}
    </DashboardPanel>
  );
}
