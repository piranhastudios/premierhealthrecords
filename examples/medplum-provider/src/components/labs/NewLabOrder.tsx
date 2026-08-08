// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Button, NumberInput, Select, Stack, Text } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { createReference, normalizeErrorString } from '@medplum/core';
import type { ChargeItem, Coding, Patient, Practitioner, Reference, ServiceRequest, Task } from '@medplum/fhirtypes';
import { CodingInput, useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useState } from 'react';
import { AWAITING_PAYMENT_BUSINESS_STATUS } from '../../utils/pay-gate';

/** Cameroon lab test catalog (LOINC). Loaded by scripts/seed-cameroon-terminology.mjs. */
const LAB_TESTS_VALUESET = 'https://premierhealth.cm/fhir/ValueSet/cameroon-lab-tests';

const CURRENCY = 'XAF';

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
 *
 * Pay-before-service: a priced order also raises a ChargeItem and a pay-gated Task
 * (on hold, awaiting payment) so the investigation is blocked until checkout
 * balances the covering invoice — same gate as the care-template path in
 * `utils/encounter.ts`. A zero-price order is explicitly ungated (free service).
 *
 * @param props - The patient being ordered for and the created callback.
 * @returns The lab order form.
 */
export function NewLabOrder(props: NewLabOrderProps): JSX.Element {
  const { patient, onCreated } = props;
  const medplum = useMedplum();
  const [test, setTest] = useState<Coding | undefined>();
  const [priority, setPriority] = useState<string>('routine');
  const [price, setPrice] = useState<number>(0);
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

      if (price > 0) {
        // The charge checkout collects (ChargeItem.supportingInformation is how the
        // release bot traces an invoice line back to this order's task).
        await medplum.createResource<ChargeItem>({
          resourceType: 'ChargeItem',
          status: 'planned',
          subject: createReference(patient),
          supportingInformation: [createReference(order)],
          code: { coding: [test], text: test.display },
          quantity: { value: 1 },
          priceOverride: { value: price, currency: CURRENCY },
          occurrenceDateTime: new Date().toISOString(),
        });

        // The gated work item: blocked until the bill is paid, released by the
        // premierhealth-release-paid-tasks bot.
        await medplum.createResource<Task>({
          resourceType: 'Task',
          status: 'on-hold',
          businessStatus: AWAITING_PAYMENT_BUSINESS_STATUS,
          intent: 'order',
          priority: priority as Task['priority'],
          code: { text: `Lab: ${test.display ?? test.code}` },
          focus: createReference(order),
          for: createReference(patient),
          authoredOn: new Date().toISOString(),
          ...(profile ? { requester: createReference(profile) as Reference<Practitioner> } : {}),
        });
      }

      showNotification({
        color: 'green',
        message:
          price > 0 ? 'Lab order created — blocked until payment' : 'Lab order created (free, not payment-gated)',
      });
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
      <Select
        label="Priority"
        data={PRIORITIES}
        value={priority}
        onChange={(v) => setPriority(v ?? 'routine')}
        allowDeselect={false}
      />
      <NumberInput
        label="Price"
        description="The test is blocked until this amount is paid at checkout. 0 = free (no payment gate)."
        value={price}
        onChange={(v) => setPrice(typeof v === 'number' ? v : 0)}
        min={0}
        suffix={` ${CURRENCY}`}
        thousandSeparator=","
      />
      {price === 0 && (
        <Text size="xs" c="dimmed">
          No charge will be raised for this order.
        </Text>
      )}
      <Button onClick={handleSubmit} loading={busy} disabled={!test}>
        Create lab order
      </Button>
    </Stack>
  );
}
