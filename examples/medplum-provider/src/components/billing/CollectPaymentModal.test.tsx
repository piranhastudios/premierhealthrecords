// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { createReference } from '@medplum/core';
import type { ChargeItem, Encounter, Patient } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { CollectPaymentModal } from './CollectPaymentModal';

const medplum = new MockClient();

describe('CollectPaymentModal', () => {
  let patient: Patient;
  let encounter: Encounter;

  beforeAll(async () => {
    patient = await medplum.createResource<Patient>({
      resourceType: 'Patient',
      name: [{ given: ['Pay'], family: 'Step' }],
    });
    encounter = await medplum.createResource<Encounter>({
      resourceType: 'Encounter',
      status: 'planned',
      class: { code: 'AMB' },
      subject: createReference(patient),
    });
    await medplum.createResource<ChargeItem>({
      resourceType: 'ChargeItem',
      status: 'planned',
      subject: createReference(patient),
      context: createReference(encounter),
      code: { text: 'General consultation' },
      priceOverride: { value: 10000, currency: 'XAF' },
    });
    await medplum.createResource<ChargeItem>({
      resourceType: 'ChargeItem',
      status: 'planned',
      subject: createReference(patient),
      context: createReference(encounter),
      code: { text: 'Malaria RDT' },
      priceOverride: { value: 2000, currency: 'XAF' },
    });
  });

  async function setup(onClose = vi.fn()): Promise<ReturnType<typeof vi.fn>> {
    await act(async () => {
      render(
        <MemoryRouter>
          <MedplumProvider medplum={medplum}>
            <MantineProvider>
              <Notifications />
              <CollectPaymentModal patient={patient} encounter={encounter} opened onClose={onClose} />
            </MantineProvider>
          </MedplumProvider>
        </MemoryRouter>
      );
    });
    return onClose;
  }

  test('itemizes the visit charges with the total due', async () => {
    await setup();
    expect(await screen.findByText('General consultation')).toBeInTheDocument();
    expect(screen.getByText('Malaria RDT')).toBeInTheDocument();
    expect(screen.getByText('Total due')).toBeInTheDocument();
    expect(screen.getByText('12,000 XAF')).toBeInTheDocument();
  });

  test('offers the three payment rails and collect-later', async () => {
    await setup();
    expect(await screen.findByText('Mobile money')).toBeInTheDocument();
    expect(screen.getByText('Card')).toBeInTheDocument();
    expect(screen.getByText('Cash')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collect later' })).toBeInTheDocument();
  });

  test('cash payment records and switches to Continue to visit', async () => {
    await setup();
    await screen.findByText('Total due');

    // Switch to the cash rail and record.
    await act(async () => {
      fireEvent.click(screen.getByText('Cash'));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Record cash payment' }));
    });

    expect(await screen.findByText('Cash payment recorded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue to visit' })).toBeInTheDocument();

    // The invoice was balanced with the charges as line items.
    const invoices = await medplum.searchResources('Invoice', `subject=Patient/${patient.id}`);
    expect(invoices.length).toBeGreaterThan(0);
    expect(invoices[0].status).toBe('balanced');
    expect(invoices[0].lineItem?.length).toBe(2);
    expect(invoices[0].totalGross?.value).toBe(12000);
  });
});
