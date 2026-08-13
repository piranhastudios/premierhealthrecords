// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Box, Container, List, Paper, Stack, Text, Title } from '@mantine/core';
import type { JSX } from 'react';
import classes from './GetStartedPage.module.css';

export function GetStartedPage(): JSX.Element {
  return (
    <Box className={classes.page} py="6rem">
      <Container size="md" className={classes.container}>
        <Stack gap="xl">
          <Box>
            <Title order={2} fw={800}>
              Get Started with Medplum Provider
            </Title>
            <Text size="lg" mt=".25rem" className={classes.textSecondary}>
              Start with the core clinical workflows used inside Provider: patient profile, schedule, and visits.
            </Text>
            <Text size="sm" mt="sm" className={classes.textSecondary}>
              Use the sections below as your day-one workflow checklist.
            </Text>
          </Box>

          <Paper radius="md" withBorder p="lg" shadow="sm">
            <Stack gap="md">
              <Title order={3}>Patient Profile</Title>
              <Text className={classes.textSecondary}>
                Use the patient profile to register patients, review demographics, and keep the summary information up
                to date during care.
              </Text>
              <List spacing="xs">
                <List.Item>Registering patients</List.Item>
                <List.Item>Editing patient demographics</List.Item>
                <List.Item>Updating the patient summary sidebar</List.Item>
              </List>
            </Stack>
          </Paper>

          <Paper radius="md" withBorder p="lg" shadow="sm">
            <Stack gap="md">
              <Title order={3}>Schedule</Title>
              <Text className={classes.textSecondary}>
                Use the schedule to manage appointments and provider availability for day-to-day clinic operations.
              </Text>
              <List spacing="xs">
                <List.Item>Scheduling a visit</List.Item>
                <List.Item>Setting provider availability</List.Item>
              </List>
            </Stack>
          </Paper>

          <Paper radius="md" withBorder p="lg" shadow="sm">
            <Stack gap="md">
              <Title order={3}>Visits</Title>
              <Text className={classes.textSecondary}>
                Document clinical encounters with visit workflows and care templates.
              </Text>
              <List spacing="xs">
                <List.Item>Understanding visits</List.Item>
                <List.Item>Documenting visits</List.Item>
                <List.Item>Setting up care templates</List.Item>
              </List>
            </Stack>
          </Paper>
        </Stack>
      </Container>
    </Box>
  );
}
