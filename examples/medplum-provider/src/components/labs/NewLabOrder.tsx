// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Button, Select, Stack } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { createReference, normalizeErrorString } from '@medplum/core';
import type { Coding, Patient, Practitioner, Reference, ServiceRequest } from '@medplum/fhirtypes';
import { CodingInput, useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useState } from 'react';

/** Cameroon lab test catalog (LOINC). Loaded by scripts/seed-cameroon-terminology.mjs. */
const LAB_TESTS_VALUESET = 'https://premierhealth.cm/fhir/ValueSet/cameroon-lab-tests';

const PRIORITIES = [
  { value: 'routine', label: 'Routine' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'asap', label: 'ASAP' },
  { value: 'stat', label: 'STAT' },
];

export interface NewLabOrderProps {
  patient: Patient;
  onCreated?: (order: ServiceRequest) => void;
}

/**
 * In-house lab order: creates a FHIR ServiceRequest for a lab test, to be performed
 * by the centre's own lab (results return as DiagnosticReport/Observation, manually
 * or from analyzers via the Medplum Agent/HL7). This replaces the upstream Health
 * Gorilla flow, which targets US lab networks.
 */
export function NewLabOrder(props: NewLabOrderProps): JSX.Element {
  const { patient, onCreated } = props;
  const medplum = useMedplum();
  const [test, setTest] = useState<Coding | undefined>();
  const [priority, setPriority] = useState<string>('routine');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(): Promise<void> {
    if (!test) {
      showNotification({ color: 'yellow', message: 'Select a test' });
      return;
    }
    setBusy(true);
    try {
      const profile = medplum.getProfile();
      const order = await medplum.createResource<ServiceRequest>({
        resourceType: 'ServiceRequest',
        status: 'active',
        intent: 'order',
        priority: priority as ServiceRequest['priority'],
        category: [
          {
            coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'LAB', display: 'Laboratory' }],
          },
        ],
        code: { coding: [test], text: test.display },
        subject: createReference(patient),
        authoredOn: new Date().toISOString(),
        ...(profile ? { requester: createReference(profile) as Reference<Practitioner> } : {}),
      });
      showNotification({ color: 'green', message: 'Lab order created' });
      onCreated?.(order);
    } catch (err) {
      showNotification({ color: 'red', message: normalizeErrorString(err), autoClose: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack gap="md">
      <CodingInput
        name="test"
        label="Test"
        binding={LAB_TESTS_VALUESET}
        path="ServiceRequest.code"
        required
        onChange={setTest}
      />
      <Select label="Priority" data={PRIORITIES} value={priority} onChange={(v) => setPriority(v ?? 'routine')} allowDeselect={false} />
      <Button onClick={handleSubmit} loading={busy} disabled={!test}>
        Create lab order
      </Button>
    </Stack>
  );
}
