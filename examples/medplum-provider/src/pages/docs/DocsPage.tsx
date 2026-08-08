// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Box, Container, List, Paper, Stack, Text, Title } from '@mantine/core';
import type { JSX } from 'react';
import classes from '../getstarted/GetStartedPage.module.css';

export function DocsPage(): JSX.Element {
  return (
    <Box className={classes.page} py="6rem">
      <Container size="md" className={classes.container}>
        <Stack gap="xl">
          <Box>
            <Title order={2} fw={800}>
              Provider Docs
            </Title>
            <Text size="lg" mt=".25rem" className={classes.textSecondary}>
              In-app guide for core Medplum Provider workflows.
            </Text>
          </Box>

          <Paper id="getting-started" radius="md" withBorder p="lg" shadow="sm">
            <Stack gap="md">
              <Title order={3}>Adding Practitioners & Data</Title>
              <Text className={classes.textSecondary}>
                Administrative setup is completed in the Medplum App and prepares your project for Provider workflows.
              </Text>
              <Title order={4}>Adding Practitioners</Title>
              <List spacing="xs" type="ordered">
                <List.Item>Open Project and then Users in the Medplum App.</List.Item>
                <List.Item>Choose Invite New User and select Practitioner as the role.</List.Item>
                <List.Item>Enter required practitioner details and a valid email.</List.Item>
                <List.Item>Optionally set access policy, admin flag, or project-scoped access.</List.Item>
                <List.Item>Send the invite to provision practitioner access.</List.Item>
              </List>
              <Title order={4}>Importing Data</Title>
              <List spacing="xs">
                <List.Item>Import patient demographics and contact information.</List.Item>
                <List.Item>Import clinical history, notes, and medication lists.</List.Item>
                <List.Item>Import lab and diagnostic data.</List.Item>
                <List.Item>Import insurance and scheduling data.</List.Item>
              </List>
            </Stack>
          </Paper>

          <Paper id="patient-profile" radius="md" withBorder p="lg" shadow="sm">
            <Stack gap="md">
              <Title order={3}>Patient Profile</Title>
              <Text className={classes.textSecondary}>
                Central workspace for registering patients, maintaining demographics, and updating summary context.
              </Text>
              <Title order={4}>Registering Patients</Title>
              <List spacing="xs" type="ordered">
                <List.Item>Open New Patient from Provider navigation.</List.Item>
                <List.Item>
                  Complete demographics, contacts, history, medications, coverage, and related fields.
                </List.Item>
                <List.Item>Confirm required acknowledgements and consents.</List.Item>
                <List.Item>Review and submit to create the patient profile.</List.Item>
              </List>
              <Title order={4}>Editing Demographics</Title>
              <List spacing="xs" type="ordered">
                <List.Item>Open a patient profile.</List.Item>
                <List.Item>Select the patient header in the summary sidebar to open edit mode.</List.Item>
                <List.Item>Update fields and save changes.</List.Item>
              </List>
              <Title order={4}>Updating Patient Summary</Title>
              <List spacing="xs">
                <List.Item>
                  Use section add actions to create summary items such as allergies, coverage, and problems.
                </List.Item>
                <List.Item>Open existing summary items to edit details in place.</List.Item>
                <List.Item>Refresh if recently updated values are not yet visible.</List.Item>
              </List>
            </Stack>
          </Paper>

          <Paper id="schedule" radius="md" withBorder p="lg" shadow="sm">
            <Stack gap="md">
              <Title order={3}>Schedule</Title>
              <Text className={classes.textSecondary}>
                Manage appointments and provider availability to keep clinic flow accurate.
              </Text>
              <Title order={4}>Scheduling a Visit</Title>
              <List spacing="xs" type="ordered">
                <List.Item>Open Schedule from the left navigation.</List.Item>
                <List.Item>Select a timeslot in day, week, or month view.</List.Item>
                <List.Item>Set patient, class, care template, and verify time range.</List.Item>
                <List.Item>Create the visit and confirm it appears on schedule and patient profile.</List.Item>
              </List>
              <Title id="scheduling" order={4}>
                Setting Provider Availability
              </Title>
              <List spacing="xs" type="ordered">
                <List.Item>Open Schedule and choose Set Availability.</List.Item>
                <List.Item>Configure availability details for the provider.</List.Item>
                <List.Item>Submit and refresh the calendar if needed.</List.Item>
              </List>
            </Stack>
          </Paper>

          <Paper id="visits" radius="md" withBorder p="lg" shadow="sm">
            <Stack gap="md">
              <Title order={3}>Visits</Title>
              <Text className={classes.textSecondary}>
                Visits combine appointment and encounter workflows with documentation, tasks, and billing context.
              </Text>
              <Title order={4}>Understanding Visits</Title>
              <List spacing="xs">
                <List.Item>ClinicalImpression chart notes are tied to the encounter flow.</List.Item>
                <List.Item>Care templates can generate tasks and linked clinical resources.</List.Item>
                <List.Item>Charge and claim resources support downstream billing operations.</List.Item>
              </List>
              <Title order={4}>How to Start a New Visit</Title>
              <List spacing="xs" type="ordered">
                <List.Item>Open a patient profile and go to Visits.</List.Item>
                <List.Item>Create a new visit or open one from schedule.</List.Item>
                <List.Item>
                  Document in Notes & Tasks and keep status updated through Planned, In Progress, Finished, or
                  Cancelled.
                </List.Item>
                <List.Item>Use Details & Billing to complete service, diagnosis, and charge information.</List.Item>
              </List>
              <Title order={4}>Care Templates</Title>
              <List spacing="xs">
                <List.Item>PlanDefinition drives visit structure and linked actions.</List.Item>
                <List.Item>Questionnaire and ActivityDefinition define structured clinical work.</List.Item>
                <List.Item>ChargeItemDefinition and related coding support claim workflows.</List.Item>
              </List>
            </Stack>
          </Paper>

          <Paper id="messages" radius="md" withBorder p="lg" shadow="sm">
            <Stack gap="md">
              <Title order={3}>Spaces</Title>
              <Text className={classes.textSecondary}>
                AI-assisted workspace for search, summaries, reporting, scheduling actions, and chart-ready insights.
              </Text>
              <Title order={4}>Prerequisites</Title>
              <List spacing="xs">
                <List.Item>Enable project features: ai and bots.</List.Item>
                <List.Item>Configure OPENAI_API_KEY in project secrets.</List.Item>
                <List.Item>Deploy and identify required Spaces bots.</List.Item>
                <List.Item>
                  Author system prompt Communication resources for translator, summary, and visualizer behavior.
                </List.Item>
              </List>
              <Title order={4}>How Spaces Works</Title>
              <List spacing="xs">
                <List.Item>Translator bot proposes FHIR calls.</List.Item>
                <List.Item>Provider UI executes those calls under the signed-in user access policy.</List.Item>
                <List.Item>Summary bot streams narrative results.</List.Item>
                <List.Item>Visualizer bot can render chart components when visualization is requested.</List.Item>
              </List>
            </Stack>
          </Paper>

          <Paper id="tasks" radius="md" withBorder p="lg" shadow="sm">
            <Stack gap="md">
              <Title order={3}>Tasks</Title>
              <Text className={classes.textSecondary}>
                Coordinate patient-care work items across clinical and operational teams.
              </Text>
              <Title order={4}>Creating a Task</Title>
              <List spacing="xs" type="ordered">
                <List.Item>Open Tasks from the left navigation.</List.Item>
                <List.Item>Use Create to open the new task form.</List.Item>
                <List.Item>Add required fields such as title and status.</List.Item>
                <List.Item>
                  Add optional fields like due date, priority, patient, assignee, and performer type.
                </List.Item>
              </List>
              <Title order={4}>Managing Tasks</Title>
              <List spacing="xs">
                <List.Item>Update task properties from the detail sidebar with auto-save behavior.</List.Item>
                <List.Item>Add notes in the task content area for team communication.</List.Item>
                <List.Item>Use filters for status and performer type to narrow lists.</List.Item>
                <List.Item>Delete tasks only when they are accidental or no longer relevant.</List.Item>
              </List>
            </Stack>
          </Paper>
        </Stack>
      </Container>
    </Box>
  );
}
