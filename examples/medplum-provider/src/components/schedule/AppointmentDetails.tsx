// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Badge, Button, Group, Stack, Text } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { createReference, formatHumanName, formatPeriod, isReference } from '@medplum/core';
import type { Appointment, Coding, Location, Patient, PlanDefinition, Practitioner } from '@medplum/fhirtypes';
import { CodingInput, Form, MedplumLink, ResourceAvatar, ResourceInput, useMedplum } from '@medplum/react';
import { useResource } from '@medplum/react-hooks';
import { IconAlertSquareRounded } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { createEncounter } from '../../utils/encounter';
import { showErrorNotification } from '../../utils/notifications';
import { PlanDefinitionSummary } from '../plandefinition/PlanDefinitionSummary';

type UpdateAppointmentFormProps = {
  appointment: Appointment;
  onUpdate: (appointment: Appointment) => void;
};

function UpdateAppointmentForm(props: UpdateAppointmentFormProps): JSX.Element {
  const medplum = useMedplum();
  const [patient, setPatient] = useState<Patient | undefined>(undefined);

  const { appointment, onUpdate } = props;
  const handleSubmit = useCallback(async () => {
    if (!patient) {
      return;
    }
    const updated = {
      ...appointment,
      participant: [
        ...appointment.participant,
        {
          actor: createReference(patient),
          status: 'tentative',
        },
      ],
    } satisfies Appointment;

    let result: Appointment;
    try {
      result = await medplum.updateResource(updated);
    } catch (error) {
      showErrorNotification(error);
      return;
    }
    onUpdate?.(result);
  }, [medplum, patient, appointment, onUpdate]);

  return (
    <Form onSubmit={handleSubmit}>
      <Stack gap="md">
        <ResourceInput
          label="Patient"
          resourceType="Patient"
          name="Patient-id"
          required={true}
          onChange={(value) => setPatient(value as Patient)}
        />

        <Button fullWidth type="submit">
          Update Appointment
        </Button>
      </Stack>
    </Form>
  );
}

// This component is used when an appointment does not have a related Encounter
// that we can direct the viewer to. It allows us to show some details for
// appointments that are not fully configured and offer UI to complete set up.
//
// As one example, this can be used after a patient has scheduled an appointment
// via $find/$hold to set up an Encounter and apply a plan definition to it.
export function AppointmentDetails(props: {
  appointment: Appointment;
  onUpdate: (appointment: Appointment) => void;
}): JSX.Element {
  const medplum = useMedplum();
  const [planDefinition, setPlanDefinition] = useState<PlanDefinition | undefined>();
  const [encounterClass, setEncounterClass] = useState<Coding | undefined>();
  // Fallback practitioner for appointments that carry none (e.g. manually created).
  const [selectedPractitioner, setSelectedPractitioner] = useState<Practitioner | undefined>();
  const [cancelling, setCancelling] = useState(false);

  // Extract references to a Patient, a Practitioner and the site (Location) from
  // `Appointment.participants`; we expect at most one of each.
  const participants = props.appointment.participant.map((p) => p.actor);
  const patientRef = participants.find((r) => isReference<Patient>(r, 'Patient'));
  const practitionerRef = participants.find((r) => isReference<Practitioner>(r, 'Practitioner'));
  const locationRef = participants.find((r) => isReference<Location>(r, 'Location'));

  const patient = useResource(patientRef);
  const location = useResource(locationRef);
  const navigate = useNavigate();

  const isCancelled = props.appointment.status === 'cancelled';

  // Cancelling frees the busy Slot(s) the booking created so $find offers the
  // time again. Bots (notifications, Cal.diy mirror) react to the status change.
  const handleCancel = useCallback(async () => {
    if (!window.confirm('Cancel this appointment? The time will become available again.')) {
      return;
    }
    setCancelling(true);
    try {
      const updated = await medplum.updateResource<Appointment>({ ...props.appointment, status: 'cancelled' });
      await Promise.all(
        (props.appointment.slot ?? []).map(async (slotRef) => {
          if (!slotRef.reference) {
            return;
          }
          const slot = await medplum.readReference(slotRef);
          await medplum.updateResource({ ...slot, status: 'free' });
        })
      );
      medplum.invalidateSearches('Appointment');
      medplum.invalidateSearches('Slot');
      showNotification({ title: 'Appointment cancelled', message: 'The slot is free again.' });
      props.onUpdate?.(updated);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setCancelling(false);
    }
  }, [medplum, props]);

  const handleSubmit = useCallback(async () => {
    if (!patient) {
      showNotification({
        color: 'yellow',
        icon: <IconAlertSquareRounded />,
        title: 'Error',
        message: 'Patient not loaded',
      });
      return;
    }

    const practitioner = practitionerRef ?? (selectedPractitioner && createReference(selectedPractitioner));
    if (!practitioner || !encounterClass) {
      showNotification({
        color: 'yellow',
        icon: <IconAlertSquareRounded />,
        title: 'Error',
        message: practitioner ? 'Please select an encounter class.' : 'Please select a practitioner.',
      });
      return;
    }

    try {
      // The appointment gains the chosen practitioner so schedule views agree with
      // the encounter.
      if (!practitionerRef) {
        const updated = await medplum.updateResource<Appointment>({
          ...props.appointment,
          participant: [...props.appointment.participant, { actor: practitioner, status: 'accepted' }],
        });
        props.onUpdate?.(updated);
      }

      // The care template is optional: without one, a plain encounter is created.
      const encounter = await createEncounter(
        medplum,
        encounterClass,
        patient,
        planDefinition,
        props.appointment,
        practitioner
      );

      // Land on the chart with the point-of-service payment step open.
      navigate(`/Patient/${patient.id}/Encounter/${encounter.id}?collect=1`)?.catch(console.error);
    } catch (err) {
      showErrorNotification(err);
    }
  }, [medplum, patient, encounterClass, planDefinition, props, navigate, practitionerRef, selectedPractitioner]);

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <div>
          <Text size="lg">{formatPeriod({ start: props.appointment.start, end: props.appointment.end })}</Text>
          {locationRef && (
            <Text size="sm" c="dimmed">
              {location?.name ?? locationRef.display ?? 'Site'}
            </Text>
          )}
          {isCancelled && (
            <Badge color="red" variant="light" mt={4}>
              Cancelled
            </Badge>
          )}
        </div>
        {!isCancelled && (
          <Button variant="subtle" color="red" size="xs" loading={cancelling} onClick={handleCancel}>
            Cancel appointment
          </Button>
        )}
      </Group>

      {!patientRef && <UpdateAppointmentForm appointment={props.appointment} onUpdate={props.onUpdate} />}

      {!!patient && (
        <>
          <Group align="center" gap="sm">
            <MedplumLink to={patient}>
              <ResourceAvatar value={patient} size={48} radius={48} />
            </MedplumLink>
            <MedplumLink to={patient} fw={800} size="lg">
              {formatHumanName(patient.name?.[0])}
            </MedplumLink>
          </Group>

          <div>
            <h3>Set Up Encounter</h3>
            <Form onSubmit={handleSubmit}>
              <Stack gap="md">
                <ResourceInput<Practitioner>
                  name="practitioner"
                  resourceType="Practitioner"
                  label="Practitioner"
                  defaultValue={practitionerRef}
                  // Selectable when the appointment carries no practitioner.
                  disabled={!!practitionerRef}
                  required={true}
                  onChange={setSelectedPractitioner}
                />

                <CodingInput
                  name="class"
                  label="Encounter Class"
                  binding="http://terminology.hl7.org/ValueSet/v3-ActEncounterCode"
                  required={true}
                  onChange={setEncounterClass}
                  path="Encounter.class"
                />

                <ResourceInput<PlanDefinition>
                  name="plandefinition"
                  resourceType="PlanDefinition"
                  label="Care template (optional)"
                  onChange={setPlanDefinition}
                />

                <PlanDefinitionSummary planDefinition={planDefinition} />

                <Button fullWidth type="submit" disabled={!encounterClass}>
                  Apply
                </Button>
              </Stack>
            </Form>
          </div>
        </>
      )}
    </Stack>
  );
}
