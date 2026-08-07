// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { ActionIcon, Avatar, Badge, Box, Button, Grid, Group, Stack, Text, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { getDisplayString, getReferenceString } from '@medplum/core';
import { Loading, useMedplumProfile } from '@medplum/react';
import {
  IconActivity,
  IconCalendarEvent,
  IconClipboardCheck,
  IconClipboardList,
  IconHeartbeat,
  IconQrcode,
  IconReceipt2,
  IconUserPlus,
  IconUsers,
} from '@tabler/icons-react';
import type { JSX, ReactNode } from 'react';
import { Link } from 'react-router';
import { endOfToday, startOfDaysAgo, startOfToday, useCount, useTodayAppointments } from '../../hooks/useDashboardMetrics';
import type { CountResult } from '../../hooks/useDashboardMetrics';
import { roleLabel, useUserRole } from '../../hooks/useUserRole';
import { AiInsightsStub } from './components/AiInsightsStub';
import { AppointmentsDonut } from './components/AppointmentsDonut';
import { DashboardCalendar } from './components/DashboardCalendar';
import { PatientsBarChart } from './components/PatientsBarChart';
import { PatientQrScanner } from './components/PatientQrScanner';
import { StatCardRow } from './components/StatCardRow';
import type { StatCardProps } from './components/StatCard';
import { TasksList } from './components/TasksList';
import classes from './DashboardPage.module.css';

const OPEN_TASK_STATUSES = 'requested,ready,received,accepted,in-progress,draft';
const PATIENT_LIST_HREF = '/Patient?_count=20&_fields=name,email,gender&_sort=-_lastUpdated';

/**
 * Renders a count as a stat value: undefined (a loader) while loading, "—" on failure.
 * @param result - The count result from useCount.
 * @returns The value to display in a stat card.
 */
function statValue(result: CountResult): number | string | undefined {
  return result.loading ? undefined : (result.count ?? '—');
}

/**
 * Time-of-day greeting.
 * @param hour - The current hour (0-23).
 * @returns "Good morning" / "Good afternoon" / "Good evening".
 */
function greetingForHour(hour: number): string {
  if (hour < 12) {
    return 'Good morning';
  }
  if (hour < 18) {
    return 'Good afternoon';
  }
  return 'Good evening';
}

/**
 * Role-based landing dashboard for the provider app. Shows a KPI row plus a set
 * of analytics/list/calendar panels whose composition adapts to the signed-in
 * user's role and permissions (front-desk, nurse, clinician, admin).
 *
 * @returns The dashboard page.
 */
export function DashboardPage(): JSX.Element {
  const profile = useMedplumProfile();
  const { role, can } = useUserRole();
  const [scannerOpened, scannerHandlers] = useDisclosure(false);

  const todayStart = startOfToday();
  const todayEnd = endOfToday();
  const weekStart = startOfDaysAgo(7);
  const profileRef = profile ? getReferenceString(profile) : undefined;

  const showClinical = role === 'nurse' || role === 'clinician' || role === 'admin';
  const isFrontOrAdmin = role === 'front-desk' || role === 'admin';

  // Shared appointment data (used by the donut and the overview list).
  const today = useTodayAppointments();

  // KPI counts — all hooks run unconditionally; `enabled` gates the network call.
  // Front desk doesn't show the all-time patient total, so skip that query for them.
  const patients = useCount('Patient', '', role !== 'front-desk');
  const apptToday = useCount('Appointment', `date=ge${todayStart}&date=le${todayEnd}`, true);
  const myTasks = useCount(
    'Task',
    profileRef ? `owner=${profileRef}&status=${OPEN_TASK_STATUSES}` : '',
    Boolean(profileRef)
  );
  const encountersInProgress = useCount('Encounter', 'status=in-progress', showClinical);
  const vitalsToday = useCount('Observation', `date=ge${todayStart}`, can.recordVitals);
  const newPatientsWeek = useCount('Patient', `_lastUpdated=ge${weekStart}`, isFrontOrAdmin);
  const outstandingInvoices = useCount('Invoice', 'status=issued', can.manageBilling);
  const checkInQueue = useCount(
    'Appointment',
    `status=arrived,booked&date=ge${todayStart}&date=le${todayEnd}`,
    can.schedule
  );

  if (!profile) {
    return <Loading />;
  }

  const now = new Date();
  const greeting = greetingForHour(now.getHours());
  const dateLabel = now.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  // Common tiles. Front desk skips the all-time "Total Patients" total (a static
  // vanity metric that isn't part of their daily flow).
  const stats: StatCardProps[] = [
    {
      icon: <IconCalendarEvent size={20} />,
      label: 'Appointments Today',
      value: statValue(apptToday),
      color: 'brand',
      href: '/Calendar/Schedule',
    },
    ...(role !== 'front-desk'
      ? [
          {
            icon: <IconUsers size={20} />,
            label: 'Total Patients',
            value: statValue(patients),
            color: 'brandRed',
            href: PATIENT_LIST_HREF,
          },
        ]
      : []),
    {
      icon: <IconClipboardCheck size={20} />,
      label: 'My Open Tasks',
      value: statValue(myTasks),
      color: 'brandGold',
      href: profileRef ? `/Task?owner=${profileRef}&status=${OPEN_TASK_STATUSES}` : '/Task',
    },
  ];

  // Role-specific tiles (appended, capped at 5 total to match the KPI row).
  if (role === 'front-desk') {
    stats.push({
      icon: <IconUserPlus size={20} />,
      label: 'New This Week',
      value: statValue(newPatientsWeek),
      color: 'teal',
      href: PATIENT_LIST_HREF,
    });
    stats.push({
      icon: <IconClipboardList size={20} />,
      label: 'Check-in Queue',
      value: statValue(checkInQueue),
      color: 'grape',
      href: '/Calendar/Schedule',
    });
    if (can.manageBilling) {
      stats.push({
        icon: <IconReceipt2 size={20} />,
        label: 'Open Invoices',
        value: statValue(outstandingInvoices),
        color: 'brandRed',
        href: '/Invoice',
      });
    }
  } else if (role === 'nurse') {
    stats.push({
      icon: <IconActivity size={20} />,
      label: 'Encounters In Progress',
      value: statValue(encountersInProgress),
      color: 'teal',
      href: '/Encounter?status=in-progress',
    });
    stats.push({
      icon: <IconHeartbeat size={20} />,
      label: 'Vitals Recorded Today',
      value: statValue(vitalsToday),
      color: 'grape',
    });
  } else {
    // clinician + admin
    stats.push({
      icon: <IconActivity size={20} />,
      label: 'Encounters In Progress',
      value: statValue(encountersInProgress),
      color: 'teal',
      href: '/Encounter?status=in-progress',
    });
  }

  const showBar = role === 'clinician' || role === 'admin' || role === 'front-desk';
  const showAi = role === 'clinician' || role === 'admin';

  // Assemble the analytics/list/calendar panels with their responsive spans.
  const panels: { span: Record<string, number> | number; node: ReactNode }[] = [
    { span: { base: 12, lg: 5 }, node: <AppointmentsDonut appointments={today.appointments} loading={today.loading} /> },
    ...(showBar ? [{ span: { base: 12, lg: 7 }, node: <PatientsBarChart /> }] : []),
    { span: { base: 12, lg: 5 }, node: <TasksList ownerRef={profileRef} /> },
    { span: { base: 12, lg: 7 }, node: <DashboardCalendar /> },
    ...(showAi ? [{ span: 12, node: <AiInsightsStub /> }] : []),
  ];

  return (
    <Box className={classes.page}>
      <Stack gap="md">
        <Group justify="space-between" align="center" className={classes.hero} wrap="wrap">
          <Group gap="sm" align="center" wrap="nowrap">
            <Avatar color="brand" radius="xl" size={44} className={classes.heroAvatar}>
              {getDisplayString(profile)
                .split(' ')
                .map((part) => part[0])
                .join('')
                .slice(0, 2)
                .toUpperCase()}
            </Avatar>
            <div>
              <Group gap="sm" align="center">
                <Text className={classes.heroTitle}>
                  {greeting}, {getDisplayString(profile)}
                </Text>
                <Badge color="rgba(255,255,255,0.25)" c="white" variant="filled" radius="sm">
                  {roleLabel(role)}
                </Badge>
              </Group>
              <Text className={classes.heroSubtitle} size="sm" mt={4}>
                Here's what's happening at Premier Health today.
              </Text>
            </div>
          </Group>
          <Group gap="sm">
            <Text className={classes.heroDate} size="sm">
              {dateLabel}
            </Text>
            <Tooltip label="Scan patient QR">
              <ActionIcon
                variant="white"
                color="brand"
                size={36}
                radius="xl"
                onClick={scannerHandlers.open}
                aria-label="Scan patient QR"
              >
                <IconQrcode size={20} />
              </ActionIcon>
            </Tooltip>
            {can.registerPatients && (
              <Button component={Link} to="/onboarding" variant="white" color="brand" leftSection={<IconUserPlus size={16} />}>
                New Patient
              </Button>
            )}
          </Group>
        </Group>

        <StatCardRow stats={stats} />

        <Box className={classes.constellation} p="md">
          <Grid gutter="md">
            {panels.map((panel, index) => (
              <Grid.Col key={index} span={panel.span}>
                {panel.node}
              </Grid.Col>
            ))}
          </Grid>
        </Box>
      </Stack>

      <PatientQrScanner opened={scannerOpened} onClose={scannerHandlers.close} />
    </Box>
  );
}
