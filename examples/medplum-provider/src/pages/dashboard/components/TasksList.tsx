// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Anchor, Badge, Center, Group, Loader, ScrollArea, Stack, Text, ThemeIcon } from '@mantine/core';
import type { Task } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { IconAlertTriangle, IconCircleCheck, IconClipboardList, IconClock } from '@tabler/icons-react';
import type { JSX, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { DashboardPanel, PanelEmptyState } from './DashboardPanel';
import classes from './TasksList.module.css';

const OPEN_TASK_STATUSES = 'requested,ready,received,accepted,in-progress,draft';

export interface TasksListProps {
  /** Reference of the current user (e.g. `Practitioner/123`) whose tasks to list. */
  ownerRef: string | undefined;
}

/**
 * Brand-aligned hex color for a Task.status.
 * @param status - The FHIR Task.status value.
 * @returns A hex color string.
 */
function taskStatusColor(status: string | undefined): string {
  switch (status) {
    case 'in-progress':
      return '#f47b20';
    case 'ready':
    case 'requested':
    case 'received':
    case 'accepted':
      return '#fdb913';
    case 'completed':
      return '#1f9d55';
    case 'cancelled':
    case 'rejected':
    case 'failed':
      return '#c8102e';
    default:
      return '#868e96';
  }
}

/**
 * Title-cases a hyphenated token, e.g. `in-progress` -> `In Progress`.
 * @param value - The token to format.
 * @returns A human-friendly label.
 */
function titleCase(value: string | undefined): string {
  if (!value) {
    return 'Unknown';
  }
  return value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * A small circular icon matching a Task.status, used as a leading badge.
 * @param status - The FHIR Task.status value.
 * @param urgent - Whether the task is flagged urgent/asap/stat.
 * @returns An icon element for the status.
 */
function taskStatusIcon(status: string | undefined, urgent: boolean): ReactNode {
  if (urgent) {
    return <IconAlertTriangle size={14} />;
  }
  switch (status) {
    case 'completed':
      return <IconCircleCheck size={14} />;
    case 'in-progress':
      return <IconClock size={14} />;
    default:
      return <IconClipboardList size={14} />;
  }
}

const URGENT_PRIORITIES = new Set(['urgent', 'asap', 'stat']);

interface Row {
  id: string;
  title: string;
  subject: string | undefined;
  status: string;
  urgent: boolean;
}

function toRow(task: Task): Row {
  return {
    id: task.id ?? '',
    title: task.code?.text ?? task.description ?? 'Task',
    subject: task.for?.display,
    status: task.status ?? 'unknown',
    urgent: URGENT_PRIORITIES.has(task.priority ?? ''),
  };
}

/**
 * "My Tasks" — a scrollable list of the current user's open tasks. Rows link to
 * the task detail page. Pairs with the "My Open Tasks" KPI tile.
 *
 * @param props - The owner reference whose tasks to list.
 * @returns The task list panel.
 */
export function TasksList(props: TasksListProps): JSX.Element {
  const { ownerRef } = props;
  const medplum = useMedplum();
  const [tasks, setTasks] = useState<Task[] | undefined>(undefined);

  useEffect(() => {
    if (!ownerRef) {
      return () => {};
    }
    let active = true;
    setTasks(undefined);
    medplum
      .searchResources('Task', [
        ['owner', ownerRef],
        ['status', OPEN_TASK_STATUSES],
        ['_sort', '-_lastUpdated'],
        ['_count', '100'],
      ])
      .then((result) => active && setTasks(result))
      .catch(() => active && setTasks([]));
    return () => {
      active = false;
    };
  }, [medplum, ownerRef]);

  const rows = (tasks ?? []).map(toRow);

  let body: ReactNode;
  if (tasks === undefined) {
    body = (
      <Center h="100%">
        <Loader />
      </Center>
    );
  } else if (rows.length === 0) {
    body = (
      <PanelEmptyState
        icon={<IconCircleCheck size={22} />}
        label="All caught up"
        hint="Tasks assigned to you will appear here"
      />
    );
  } else {
    body = (
      <ScrollArea h="100%" type="auto">
        <Stack gap={0}>
          {rows.map((row) => (
            <Group
              key={row.id}
              renderRoot={(rootProps) => <Link to={`/Task/${row.id}`} {...rootProps} />}
              className={classes.row}
              wrap="nowrap"
              gap="sm"
            >
              <ThemeIcon
                variant="filled"
                color={taskStatusColor(row.status)}
                radius="xl"
                size={28}
                style={{ flexShrink: 0 }}
              >
                {taskStatusIcon(row.status, row.urgent)}
              </ThemeIcon>
              <div className={classes.main}>
                <Text size="sm" fw={500} lineClamp={1}>
                  {row.title}
                </Text>
                {row.subject && (
                  <Text size="xs" c="dimmed" lineClamp={1}>
                    {row.subject}
                  </Text>
                )}
              </div>
              {row.urgent && (
                <Badge variant="light" color="#c8102e" size="sm">
                  Urgent
                </Badge>
              )}
              <Badge variant="light" color={taskStatusColor(row.status)} size="sm">
                {titleCase(row.status)}
              </Badge>
            </Group>
          ))}
        </Stack>
      </ScrollArea>
    );
  }

  return (
    <DashboardPanel
      title="My Tasks"
      subtitle="Open tasks assigned to you"
      action={
        <Anchor component={Link} to="/Task" size="sm">
          View all
        </Anchor>
      }
      bodyHeight={460}
    >
      {body}
    </DashboardPanel>
  );
}
