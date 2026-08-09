// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Button, Flex, Input, SegmentedControl, Stack, Text, Title } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { isValidDate } from '@medplum/core';
import type { Coding, Patient, PlanDefinition, Practitioner, Reference, Schedule } from '@medplum/fhirtypes';
import { CodingInput, DateTimeInput, Form, ResourceInput, useMedplum } from '@medplum/react';
import { IconAlertSquareRounded, IconCircleCheck, IconCirclePlus } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Range } from '../../types/scheduling';
import type { AppointmentTypeCode } from '../../utils/encounter';
import { APPOINTMENT_TYPES, createAppointment, createEncounter } from '../../utils/encounter';
import { showErrorNotification } from '../../utils/notifications';
import { PlanDefinitionSummary } from '../plandefinition/PlanDefinitionSummary';

interface CreateVisitProps {
  appointmentSlot: Range | undefined;
  practitioner: Reference<Practitioner>;
  schedule?: Schedule;
}

export function CreateVisit(props: CreateVisitProps): JSX.Element {
  const { appointmentSlot, schedule } = props;
  const [patient, setPatient] = useState<Patient | undefined>();
  const [planDefinitionData, setPlanDefinitionData] = useState<PlanDefinition | undefined>();
  const [encounterClass, setEncounterClass] = useState<Coding | undefined>();
  const [appointmentType, setAppointmentType] = useState<AppointmentTypeCode>('ROUTINE');
  const [start, setStart] = useState(appointmentSlot?.start);
  const [end, setEnd] = useState(appointmentSlot?.end);
  // The end DateTimeInput is uncontrolled (defaultValue only), so remount it
  // via `key` whenever the end time is set programmatically. The slot's own
  // end is the initial default before any interaction; manual edits to the
  // end input never bump the key, so they are preserved.
  const [endInputSeed, setEndInputSeed] = useState<{ key: number; value: string | undefined }>(() => ({
    key: 0,
    value: appointmentSlot?.end?.toISOString(),
  }));
  const [isLoading, setIsLoading] = useState(false);
  const medplum = useMedplum();
  const navigate = useNavigate();

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

  const [formattedDate, formattedSlotTime] = useMemo(() => {
    if (!appointmentSlot) {
      return ['', ''];
    }

    const startDate = new Date(appointmentSlot?.start);
    const endDate = new Date(appointmentSlot?.end);

    const options: Intl.DateTimeFormatOptions = {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    };
    const dateStr = startDate.toLocaleDateString('en-US', options);

    const timeOptions: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: 'numeric', hour12: true };
    const startTimeStr = startDate.toLocaleTimeString('en-US', timeOptions);
    const endTimeStr = endDate.toLocaleTimeString('en-US', timeOptions);

    const formattedTime = `${startTimeStr} – ${endTimeStr}`;
    return [dateStr, formattedTime];
  }, [appointmentSlot]);

  async function handleSubmit(): Promise<void> {
    if (!patient || !encounterClass || !start || !end) {
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
        props.practitioner,
        schedule,
        APPOINTMENT_TYPES[appointmentType].concept
      );
      const encounter = await createEncounter(
        medplum,
        encounterClass,
        patient,
        planDefinitionData,
        appointment,
        props.practitioner
      );
      showNotification({ icon: <IconCircleCheck />, title: 'Success', message: 'Visit created' });
      // Land on the chart with the point-of-service payment step open.
      navigate(`/Patient/${patient.id}/Encounter/${encounter.id}?collect=1`)?.catch(console.error);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form onSubmit={handleSubmit}>
      <Flex direction="column" gap="md" h="100%" justify="space-between">
        <Stack gap="md" h="100%">
          <Stack gap={0}>
            <Title order={1} fw={500}>
              {formattedDate}
            </Title>
            <Text size="lg">{formattedSlotTime}</Text>
          </Stack>

          <ResourceInput
            label="Practitioner"
            resourceType="Practitioner"
            name="Practitioner-id"
            required={true}
            defaultValue={props.practitioner}
            disabled={true}
          />

          <ResourceInput
            label="Patient"
            resourceType="Patient"
            name="Patient-id"
            required={true}
            onChange={(value) => setPatient(value as Patient)}
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

          <DateTimeInput
            name="start"
            label="Start Time"
            defaultValue={appointmentSlot?.start?.toISOString()}
            required={true}
            onChange={handleStartChange}
          />

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

          <ResourceInput
            name="plandefinition"
            resourceType="PlanDefinition"
            label="Care template"
            // Exclude campaign PlanDefinitions (marketing engine) from the care-template picker.
            searchCriteria={{ 'type:not': 'https://premierhealth.cm/fhir/CodeSystem/plan-type|campaign' }}
            onChange={(value) => {
              setPlanDefinitionData(value as PlanDefinition);
            }}
            required={false}
          />
        </Stack>

        <PlanDefinitionSummary planDefinition={planDefinitionData} />

        <Button fullWidth mt="xl" type="submit" loading={isLoading} disabled={isLoading}>
          <IconCirclePlus /> <Text ml="xs">Create Visit</Text>
        </Button>
      </Flex>
    </Form>
  );
}
