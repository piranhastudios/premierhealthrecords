// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Box, Button, Card, Grid, Input, Modal, SegmentedControl, Stack, Text } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { isResource, isValidDate, normalizeErrorString } from '@medplum/core';
import type { Coding, Encounter, PlanDefinition, Practitioner } from '@medplum/fhirtypes';
import { CodeInput, CodingInput, DateTimeInput, ResourceInput, useMedplum } from '@medplum/react';
import { IconAlertSquareRounded, IconCircleCheck, IconCircleOff } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { PlanDefinitionSummary } from '../../components/plandefinition/PlanDefinitionSummary';
import { usePatient } from '../../hooks/usePatient';
import type { AppointmentTypeCode } from '../../utils/encounter';
import { APPOINTMENT_TYPES, createAppointment, createEncounter } from '../../utils/encounter';
import classes from './EncounterModal.module.css';

export const EncounterModal = (): JSX.Element => {
  const navigate = useNavigate();
  const medplum = useMedplum();
  const patient = usePatient();
  const [isOpen, setIsOpen] = useState(true);
  const [appointmentType, setAppointmentType] = useState<AppointmentTypeCode>('ROUTINE');
  const [start, setStart] = useState<Date | undefined>();
  const [end, setEnd] = useState<Date | undefined>();
  // The end DateTimeInput is uncontrolled (defaultValue only), so remount it
  // via `key` whenever the end time is set programmatically. Manual edits to
  // the end input never bump the key, so they are preserved.
  const [endInputSeed, setEndInputSeed] = useState<{ key: number; value: string | undefined }>({
    key: 0,
    value: undefined,
  });
  const [encounterClass, setEncounterClass] = useState<Coding | undefined>();
  const [planDefinitionData, setPlanDefinitionData] = useState<PlanDefinition | undefined>();
  const [status, setStatus] = useState<Encounter['status'] | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [practitioner, setPractitioner] = useState<Practitioner | undefined>(() => {
    const profile = medplum.getProfile();
    if (isResource<Practitioner>(profile, 'Practitioner')) {
      return profile;
    }
    return undefined;
  });

  const autoSetEnd = (startDate: Date | undefined, typeCode: AppointmentTypeCode): void => {
    if (!startDate || !isValidDate(startDate)) {
      return;
    }
    const newEnd = new Date(startDate.getTime() + APPOINTMENT_TYPES[typeCode].durationMinutes * 60 * 1000);
    setEnd(newEnd);
    setEndInputSeed((prev) => ({ key: prev.key + 1, value: newEnd.toISOString() }));
  };

  const handleStartChange = (value: string): void => {
    const newStart = value ? new Date(value) : undefined;
    setStart(newStart);
    autoSetEnd(newStart, appointmentType);
  };

  const handleAppointmentTypeChange = (value: string): void => {
    const typeCode = value as AppointmentTypeCode;
    setAppointmentType(typeCode);
    autoSetEnd(start, typeCode);
  };

  const handleCreateEncounter = async (): Promise<void> => {
    if (!patient || !encounterClass || !start || !end || !status || !practitioner) {
      showNotification({
        color: 'yellow',
        icon: <IconAlertSquareRounded />,
        title: 'Error',
        message: 'Please fill out required fields.',
      });
      return;
    }

    setIsLoading(true);

    try {
      const appointment = await createAppointment(
        medplum,
        start,
        end,
        patient,
        practitioner,
        undefined,
        APPOINTMENT_TYPES[appointmentType].concept
      );
      const encounter = await createEncounter(
        medplum,
        encounterClass,
        patient,
        planDefinitionData,
        appointment,
        practitioner,
        status
      );
      showNotification({ icon: <IconCircleCheck />, title: 'Success', message: 'Encounter created' });
      // Land on the chart with the point-of-service payment step open.
      navigate(`/Patient/${patient.id}/Encounter/${encounter.id}?collect=1`)?.catch(console.error);
    } catch (err) {
      showNotification({ color: 'red', icon: <IconCircleOff />, title: 'Error', message: normalizeErrorString(err) });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      opened={isOpen}
      onClose={() => {
        navigate(-1)?.catch(console.error);
        setIsOpen(false);
      }}
      size="60%"
      title="New encounter"
      styles={{ title: { fontSize: '1.125rem', fontWeight: 600 }, body: { padding: 0, height: '60vh' } }}
    >
      <Stack h="100%" justify="space-between" gap={0}>
        <Box flex={1} miw={0}>
          <Grid p="md" h="100%">
            <Grid.Col span={6} pr="md">
              <Stack gap="md">
                <ResourceInput
                  label="Patient"
                  resourceType="Patient"
                  name="Patient-id"
                  defaultValue={patient}
                  disabled={true}
                  required={true}
                />

                <ResourceInput
                  label="Practitioner"
                  resourceType="Practitioner"
                  name="Practitioner-id"
                  defaultValue={practitioner}
                  required={true}
                  onChange={(value) => setPractitioner(value)}
                />

                <Input.Wrapper label="Appointment type" required={true}>
                  <SegmentedControl
                    fullWidth
                    name="appointment-type"
                    value={appointmentType}
                    onChange={handleAppointmentTypeChange}
                    data={[
                      { label: APPOINTMENT_TYPES.ROUTINE.label, value: 'ROUTINE' },
                      { label: APPOINTMENT_TYPES.FOLLOWUP.label, value: 'FOLLOWUP' },
                      { label: APPOINTMENT_TYPES.VIRTUAL.label, value: 'VIRTUAL' },
                    ]}
                  />
                </Input.Wrapper>

                <DateTimeInput name="start" label="Start Time" required={true} onChange={handleStartChange} />

                <DateTimeInput
                  key={endInputSeed.key}
                  name="end"
                  label="End Time"
                  defaultValue={endInputSeed.value}
                  required={true}
                  onChange={(value) => {
                    setEnd(value ? new Date(value) : undefined);
                  }}
                />

                <CodingInput
                  name="class"
                  label="Class"
                  binding="http://terminology.hl7.org/ValueSet/v3-ActEncounterCode"
                  required={true}
                  onChange={setEncounterClass}
                  path="Encounter.class"
                />

                <CodeInput
                  name="status"
                  label="Status"
                  binding="http://hl7.org/fhir/ValueSet/encounter-status|4.0.1"
                  maxValues={1}
                  required={true}
                  onChange={(value) => {
                    if (value) {
                      setStatus(value as typeof status);
                    }
                  }}
                />
              </Stack>
            </Grid.Col>

            <Grid.Col span={6}>
              <Card padding="lg" radius="md" className={classes.planDefinition}>
                <Text size="md" fw={500} mb="xs">
                  Apply care template
                </Text>
                <Text size="sm" color="dimmed" mb="lg">
                  You can select template for new encounter. Tasks from the template will be automatically added to the
                  encounter. Administrators can create and edit templates in the{' '}
                  <Text component="a" href="#" variant="link">
                    Medplum app
                  </Text>
                  .
                </Text>

                <ResourceInput
                  name="plandefinition"
                  resourceType="PlanDefinition"
                  onChange={(value) => setPlanDefinitionData(value as PlanDefinition)}
                  required={false}
                />

                <PlanDefinitionSummary planDefinition={planDefinitionData} />
              </Card>
            </Grid.Col>
          </Grid>
        </Box>

        <Box className={classes.footer} h={70} p="md">
          <Button fullWidth={false} onClick={handleCreateEncounter} loading={isLoading} disabled={isLoading}>
            Create Encounter
          </Button>
        </Box>
      </Stack>
    </Modal>
  );
};
