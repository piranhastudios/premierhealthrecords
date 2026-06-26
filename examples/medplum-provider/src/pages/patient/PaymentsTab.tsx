// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Badge, Card, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { getReferenceString } from '@medplum/core';
import type { Invoice } from '@medplum/fhirtypes';
import { Document, useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { CheckoutPanel } from '../../components/billing/CheckoutPanel';
import { usePatient } from '../../hooks/usePatient';

const INVOICE_STATUS_COLOR: Record<string, string> = {
  balanced: 'green',
  issued: 'blue',
  draft: 'gray',
  cancelled: 'red',
  'entered-in-error': 'red',
};

export function PaymentsTab(): JSX.Element {
  const medplum = useMedplum();
  const patient = usePatient();
  const [invoices, setInvoices] = useState<Invoice[]>();

  const loadInvoices = useCallback(() => {
    if (!patient?.id) {
      return;
    }
    medplum
      .searchResources('Invoice', `subject=${getReferenceString(patient)}&_sort=-_lastUpdated&_count=20`)
      .then(setInvoices)
      .catch(console.error);
  }, [medplum, patient]);

  useEffect(() => loadInvoices(), [loadInvoices]);

  if (!patient) {
    return (
      <Document>
        <Loader />
      </Document>
    );
  }

  return (
    <Document>
      <Stack gap="lg">
        <Card withBorder padding="lg" radius="md" maw={460}>
          <CheckoutPanel patient={patient} onPaid={loadInvoices} />
        </Card>

        <Stack gap="xs">
          <Title order={5}>Recent invoices</Title>
          {invoices === undefined && <Loader size="sm" />}
          {invoices?.length === 0 && (
            <Text c="dimmed" size="sm">
              No invoices yet.
            </Text>
          )}
          {invoices?.map((invoice) => (
            <Card key={invoice.id} withBorder padding="sm" radius="md">
              <Group justify="space-between">
                <Text size="sm">
                  {invoice.totalGross?.value?.toLocaleString() ?? '—'} {invoice.totalGross?.currency ?? ''}
                </Text>
                <Group gap="xs">
                  <Text size="xs" c="dimmed">
                    {invoice.date?.slice(0, 10)}
                  </Text>
                  <Badge color={INVOICE_STATUS_COLOR[invoice.status] ?? 'gray'} variant="light">
                    {invoice.status}
                  </Badge>
                </Group>
              </Group>
            </Card>
          ))}
        </Stack>
      </Stack>
    </Document>
  );
}
