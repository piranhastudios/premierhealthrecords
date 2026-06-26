// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Alert, Badge, Button, Group, NumberInput, Select, Stack, Text, TextInput } from '@mantine/core';
import { createReference, getReferenceString, normalizeErrorString } from '@medplum/core';
import type { Invoice, Money, Parameters, Patient, PaymentReconciliation, Reference } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';

// Mobile-money correspondents available in Cameroon. Extend as pawaPay adds markets.
const CORRESPONDENTS = [
  { value: 'MTN_MOMO_CMR', label: 'MTN Mobile Money' },
  { value: 'ORANGE_CMR', label: 'Orange Money' },
];

const DEFAULT_CURRENCY = 'XAF';
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 20;

type CollectionStatus = 'idle' | 'pending' | 'completed' | 'failed';

export interface PaymentCollectionProps {
  patient: Patient;
  /** Existing invoice to collect against. If omitted, one is created from the entered amount. */
  invoice?: Invoice;
  /** Pre-filled amount when no invoice is supplied. */
  defaultAmount?: Money;
  onPaid?: (invoice: Invoice) => void;
}

/**
 * Collects a patient payment via mobile money (pawaPay), used at front-desk
 * checkout and at the end of a telemedicine visit. Calls the server `Invoice/$pay`
 * operation, then polls until the invoice is balanced or the collection fails.
 */
export function PaymentCollection(props: PaymentCollectionProps): JSX.Element {
  const { patient, invoice, defaultAmount, onPaid } = props;
  const medplum = useMedplum();

  const [phone, setPhone] = useState('');
  const [correspondent, setCorrespondent] = useState(CORRESPONDENTS[0].value);
  const [amount, setAmount] = useState<number | undefined>(
    defaultAmount?.value ?? invoice?.totalGross?.value ?? invoice?.totalNet?.value
  );
  const currency = defaultAmount?.currency ?? invoice?.totalGross?.currency ?? DEFAULT_CURRENCY;

  const [status, setStatus] = useState<CollectionStatus>('idle');
  const [message, setMessage] = useState<string>();

  // Reflect an externally-driven amount (e.g. the patient co-pay portion) while idle.
  const defaultAmountValue = defaultAmount?.value;
  useEffect(() => {
    if (!invoice && defaultAmountValue !== undefined && status === 'idle') {
      setAmount(defaultAmountValue);
    }
  }, [defaultAmountValue, invoice, status]);

  const busy = status === 'pending';

  async function handleCollect(): Promise<void> {
    setMessage(undefined);
    if (!phone.trim()) {
      setMessage('Enter the payer phone number');
      return;
    }
    if (amount === undefined || amount <= 0) {
      setMessage('Enter an amount greater than zero');
      return;
    }

    setStatus('pending');
    try {
      // Use the provided invoice or create one for this collection.
      const targetInvoice =
        invoice ??
        (await medplum.createResource<Invoice>({
          resourceType: 'Invoice',
          status: 'issued',
          subject: createReference(patient),
          date: new Date().toISOString(),
          totalGross: { value: amount, currency },
        }));

      const params: Parameters = {
        resourceType: 'Parameters',
        parameter: [
          { name: 'payerPhone', valueString: phone.trim() },
          { name: 'correspondent', valueString: correspondent },
          { name: 'amount', valueMoney: { value: amount, currency } },
        ],
      };

      const response = (await medplum.post(
        medplum.fhirUrl('Invoice', targetInvoice.id as string, '$pay'),
        params
      )) as Parameters;

      const submitStatus = getParam(response, 'status');
      if (submitStatus !== 'ACCEPTED') {
        setStatus('failed');
        setMessage(`Payment was not accepted (${submitStatus ?? 'unknown'})`);
        return;
      }

      setMessage('Payment request sent — waiting for the patient to approve on their phone…');
      const reconRef = response.parameter?.find((p) => p.name === 'paymentReconciliation')?.valueReference as
        | Reference<PaymentReconciliation>
        | undefined;

      const settled = await pollUntilSettled(targetInvoice, reconRef);
      if (settled) {
        setStatus('completed');
        setMessage('Payment received.');
        onPaid?.(targetInvoice);
      } else {
        setStatus('failed');
        setMessage('Payment was not completed. Ask the patient to retry.');
      }
    } catch (err) {
      setStatus('failed');
      setMessage(normalizeErrorString(err));
    }
  }

  // Polls the invoice (and, for failures, the reconciliation) until a terminal state.
  async function pollUntilSettled(
    targetInvoice: Invoice,
    reconRef: Reference<PaymentReconciliation> | undefined
  ): Promise<boolean> {
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      await delay(POLL_INTERVAL_MS);
      const fresh = await medplum.readResource('Invoice', targetInvoice.id as string);
      if (fresh.status === 'balanced') {
        return true;
      }
      if (reconRef?.reference) {
        const recon = await medplum.readReference(reconRef);
        if (recon.outcome === 'error' || recon.status === 'cancelled') {
          return false;
        }
      }
    }
    return false;
  }

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text fw={600}>Collect payment</Text>
        <StatusBadge status={status} />
      </Group>

      <NumberInput
        label="Amount"
        value={amount}
        onChange={(v) => setAmount(typeof v === 'number' ? v : undefined)}
        min={0}
        disabled={busy || Boolean(invoice)}
        suffix={` ${currency}`}
        thousandSeparator=" "
      />
      <TextInput
        label="Payer phone"
        placeholder="+237 6 90 00 00 00"
        value={phone}
        onChange={(e) => setPhone(e.currentTarget.value)}
        disabled={busy}
      />
      <Select
        label="Mobile money provider"
        data={CORRESPONDENTS}
        value={correspondent}
        onChange={(v) => setCorrespondent(v ?? CORRESPONDENTS[0].value)}
        allowDeselect={false}
        disabled={busy}
      />

      {message && (
        <Alert color={status === 'failed' ? 'red' : status === 'completed' ? 'green' : 'blue'} variant="light">
          {message}
        </Alert>
      )}

      <Button onClick={handleCollect} loading={busy} disabled={status === 'completed'}>
        {status === 'completed' ? 'Paid' : 'Request payment'}
      </Button>
      {invoice?.id && (
        <Text size="xs" c="dimmed">
          Invoice {getReferenceString(invoice)}
        </Text>
      )}
    </Stack>
  );
}

function StatusBadge({ status }: { status: CollectionStatus }): JSX.Element | null {
  switch (status) {
    case 'pending':
      return <Badge color="blue">Pending</Badge>;
    case 'completed':
      return <Badge color="green">Paid</Badge>;
    case 'failed':
      return <Badge color="red">Failed</Badge>;
    default:
      return null;
  }
}

function getParam(params: Parameters, name: string): string | undefined {
  return params.parameter?.find((p) => p.name === name)?.valueString;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
