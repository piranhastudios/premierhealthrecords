// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Stack, Text } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { createReference, normalizeErrorString, normalizeOperationOutcome } from '@medplum/core';
import type { OperationOutcome, Patient, Resource, ResourceType } from '@medplum/fhirtypes';
import { Document, Loading, useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ResourceFormWithRequiredProfile } from '../../components/ResourceFormWithRequiredProfile';
import type { InsuranceSelection } from '../../components/registration/InsuranceStep';
import { InsuranceStep } from '../../components/registration/InsuranceStep';
import { usePatient } from '../../hooks/usePatient';
import { createCoverage } from '../../utils/insurance';
import { prependPatientPath } from '../patient/PatientPage.utils';
import { RESOURCE_PROFILE_URLS } from './utils';

const PatientReferencesElements: Partial<Record<ResourceType, string[]>> = {
  Task: ['for'],
  MedicationRequest: ['subject'],
  ServiceRequest: ['subject'],
  Device: ['patient'],
  DiagnosticReport: ['subject'],
  DocumentReference: ['subject'],
  Appointment: ['participant.actor'],
  CarePlan: ['subject'],
};

function getDefaultValue(resourceType: ResourceType, patient: Patient | undefined): Partial<Resource> {
  const dv = { resourceType } as Partial<Resource>;
  if (resourceType === 'Patient') {
    // Pre-render one phone row: the profile requires a telecom (min=1) but the form
    // renders no row for it, and the dialing-code selector only appears once the
    // row's system is "phone".
    (dv as Partial<Patient>).telecom = [{ system: 'phone' }];
  }
  const refKeys = PatientReferencesElements[resourceType];
  if (patient && refKeys) {
    for (const key of refKeys) {
      const keyParts = key.split('.');
      if (keyParts.length === 1) {
        (dv as any)[key] = createReference(patient);
      } else if (keyParts.length === 2) {
        const [first, second] = keyParts;
        (dv as any)[first] = [{ [second]: createReference(patient) }];
      } else {
        throw new Error('Can only process keys with one or two parts');
      }
    }
  }

  return dv;
}

function getResourceTypeFromPath(pathname: string): ResourceType | undefined {
  const pathParts = pathname.split('/');
  if (pathParts.length >= 3 && pathParts[2] === 'new') {
    return pathParts[1] as ResourceType;
  }

  return undefined;
}

export function ResourceCreatePage(): JSX.Element {
  const medplum = useMedplum();
  const [outcome, setOutcome] = useState<OperationOutcome | undefined>();
  const patient = usePatient({ ignoreMissingPatientId: true, setOutcome });
  const navigate = useNavigate();
  const params = useParams() as { patientId?: string; resourceType?: ResourceType };
  const resourceType = params.resourceType || getResourceTypeFromPath(location.pathname);
  const patientId = params.patientId;
  const [loadingPatient, setLoadingPatient] = useState(Boolean(patientId));
  const [defaultValue, setDefaultValue] = useState<Partial<Resource>>(() => {
    if (!resourceType) {
      return {};
    }
    return getDefaultValue(resourceType, patient);
  });
  const profileUrl = resourceType && RESOURCE_PROFILE_URLS[resourceType];
  // Held in a ref: the insurance step is submitted with the form, not on change.
  const insuranceRef = useRef<InsuranceSelection | undefined>(undefined);
  // Standalone /Patient/new is the front-desk registration flow; inside a patient's
  // chart (/Patient/:id/Patient/new makes no sense anyway) there is no insurance step.
  const isRegistration = resourceType === 'Patient' && !patientId;

  useEffect(() => {
    if (patient && resourceType) {
      setDefaultValue(getDefaultValue(resourceType, patient));
    }
    setLoadingPatient(false);
  }, [patient, resourceType]);

  const handleSubmit = (newResource: Resource): void => {
    if (outcome) {
      setOutcome(undefined);
    }
    medplum
      .createResource(newResource)
      .then(async (result) => {
        // Registration extra: attach the selected insurer as a Coverage. A failure
        // here must not strand the registration — surface it and continue to the chart.
        const selection = insuranceRef.current;
        if (result.resourceType === 'Patient' && selection?.insurer) {
          try {
            await createCoverage(medplum, result, selection.insurer, selection.subscriberId, selection.copayPercent);
          } catch (err) {
            showNotification({
              color: 'yellow',
              title: 'Patient created, but adding insurance failed',
              message: normalizeErrorString(err),
              autoClose: false,
            });
          }
        }
        return navigate(prependPatientPath(patient, '/' + result.resourceType + '/' + result.id));
      })
      .catch((err) => {
        if (setOutcome) {
          setOutcome(normalizeOperationOutcome(err));
        }
        showNotification({
          color: 'red',
          message: normalizeErrorString(err),
          autoClose: false,
          styles: { description: { whiteSpace: 'pre-line' } },
        });
      });
  };

  if (loadingPatient) {
    return <Loading />;
  }

  return (
    <Document shadow="xs">
      <Stack>
        <Text fw={500}>New&nbsp;{resourceType}</Text>
        {isRegistration && (
          <InsuranceStep
            onChange={(selection) => {
              insuranceRef.current = selection;
            }}
          />
        )}
        <ResourceFormWithRequiredProfile
          defaultValue={defaultValue}
          onSubmit={handleSubmit}
          outcome={outcome}
          profileUrl={profileUrl}
          hideResourceTypeHeader={resourceType === 'Patient'}
        />
      </Stack>
    </Document>
  );
}
