// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from '../AppRoutes';
import { act, render, screen } from '../test-utils/render';

const medplum = new MockClient();

async function setup(url: string): Promise<void> {
  await act(async () => {
    render(
      <MedplumProvider medplum={medplum}>
        <MemoryRouter initialEntries={[url]} initialIndex={0}>
          <MantineProvider>
            <Notifications />
            <AppRoutes />
          </MantineProvider>
        </MemoryRouter>
      </MedplumProvider>
    );
  });
}

describe('QuickBooksPage', () => {
  beforeAll(() => {
    medplum.setActiveLoginOverride({
      accessToken: '123',
      refreshToken: '456',
      profile: {
        reference: 'Practitioner/123',
      },
      project: {
        reference: 'Project/123',
      },
    });
  });

  test('Renders with not-configured status', async () => {
    await setup('/admin/quickbooks');
    expect(await screen.findByText('QuickBooks')).toBeInTheDocument();
    expect(await screen.findByTestId('qbo-status')).toHaveTextContent('Not configured');
  });

  test('Shows the setup sections and gates the actions', async () => {
    await setup('/admin/quickbooks');
    expect(await screen.findByText('1. Intuit app credentials')).toBeInTheDocument();
    expect(screen.getByText('2. Connect the company')).toBeInTheDocument();
    expect(screen.getByText('3. Service pricing')).toBeInTheDocument();

    // Without credentials, connect and pricing are disabled.
    expect(screen.getByRole('button', { name: 'Connect to QuickBooks' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Pull pricing now' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save credentials' })).toBeEnabled();
  });
});
