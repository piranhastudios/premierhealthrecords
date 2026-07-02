// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Alert, Button, NumberInput, Select, Stack, Text, TextInput } from '@mantine/core';
import { createReference, normalizeErrorString, sleep } from '@medplum/core';
import type { ChargeItem, Invoice, Money, Parameters, Patient } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';

const DEFAULT_CURRENCY = 'XAF';
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 20;

// Presentment currencies a cross-border payer can be charged in. XAF keeps the
// payer on the invoice currency; the others convert via the server FX rate.
const PRESENTMENT_CURRENCIES = [
  { value: 'XAF', label: 'XAF (CFA franc)' },
  { value: 'USD', label: 'USD (US dollar)' },
  { value: 'EUR', label: 'EUR (Euro)' },
  { value: 'GBP', label: 'GBP (Pound sterling)' },
];

type CardStatus = 'idle' | 'redirecting' | 'returning' | 'completed' | 'failed';

export interface CardPaymentPanelProps {
  patient: Patient;
  /** Existing invoice to collect against. If omitted, one is created from the entered amount. */
  invoice?: Invoice;
  /** Pre-filled amount when no invoice is supplied. */
  defaultAmount?: Money;
  /** ChargeItems this payment covers; linked on created invoices so the pay-gate bot can release their tasks. */
  chargeItems?: ChargeItem[];
  /**
   * Invoice id from the Stripe success redirect (?payment=success&invoice=<id>),
   * parsed by PaymentCollection where the redirect lands. When set, the panel
   * polls that invoice until it balances instead of starting a new checkout.
   */
  returnInvoiceId?: string;
  onPaid?: (invoice: Invoice) => void;
}

/**
 * Collects a patient payment by card via Stripe Hosted Checkout. Supports a
 * cross-border payer: the invoice is denominated in XAF but the payer can be
 * charged in a foreign presentment currency. Calls the server `Invoice/$checkout`
 * operation and redirects to Stripe's hosted page; on return (?payment=success) it
 * polls the invoice until it is balanced.
 * @param props - The card payment panel props (patient, invoice, defaultAmount, onPaid).
 * @returns The card payment panel.
 */
export function CardPaymentPanel(props: CardPaymentPanelProps): JSX.Element {
  const { patient, invoice, defaultAmount, chargeItems, returnInvoiceId, onPaid } = props;
  const medplum = useMedplum();

  const [amount, setAmount] = useState<number | undefined>(
    defaultAmount?.value ?? invoice?.totalGross?.value ?? invoice?.totalNet?.value
  );
  const invoiceCurrency = defaultAmount?.currency ?? invoice?.totalGross?.currency ?? DEFAULT_CURRENCY;
  const [presentmentCurrency, setPresentmentCurrency] = useState<string>(invoiceCurrency);
  const [payerEmail, setPayerEmail] = useState('');

  const [status, setStatus] = useState<CardStatus>('idle');
  const [message, setMessage] = useState<string>();

  // Reflect an externally-driven amount (e.g. the patient co-pay portion) while idle.
  const defaultAmountValue = defaultAmount?.value;
  useEffect(() => {
    if (!invoice && defaultAmountValue !== undefined && status === 'idle') {
      setAmount(defaultAmountValue);
    }
  }, [defaultAmountValue, invoice, status]);

  // On return from Stripe (?payment=success&invoice=<id>), poll the invoice until
  // it balances. After the redirect this panel remounts with no local state, so
  // the invoice id comes from the returnInvoiceId prop (parsed from the query
  // string by PaymentCollection); the invoice prop covers direct-invoice usage.
  useEffect(() => {
    const pollInvoiceId =
      returnInvoiceId ?? (window.location.search.includes('payment=success') ? invoice?.id : undefined);
    if (!pollInvoiceId) {
      return undefined;
    }
    let cancelled = false;
    setStatus('returning');
    setMessage('Confirming your payment…');
    (async () => {
      for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
        await sleep(POLL_INTERVAL_MS);
        if (cancelled) {
          return;
        }
        const fresh = await medplum.readResource('Invoice', pollInvoiceId);
        if (fresh.status === 'balanced') {
          if (!cancelled) {
            setStatus('completed');
            setMessage('Payment received.');
            onPaid?.(fresh);
          }
          return;
        }
      }
      if (!cancelled) {
        setStatus('failed');
        setMessage('Payment is still processing. Refresh in a moment to check the status.');
      }
    })().catch((err) => {
      if (!cancelled) {
        setStatus('failed');
        setMessage(normalizeErrorString(err));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [returnInvoiceId, invoice, medplum, onPaid]);

  const busy = status === 'redirecting' || status === 'returning';

  async function handleCheckout(): Promise<void> {
    setMessage(undefined);
    if (amount === undefined || amount <= 0) {
      setMessage('Enter an amount greater than zero');
      return;
    }

    setStatus('redirecting');
    try {
      // Use the provided invoice or create one for this collection (mirrors the
      // momo path). Link the charges being paid (lineItem) so the
      // release-paid-tasks bot can find the pay-gated tasks once it balances.
      const targetInvoice =
        invoice ??
        (await medplum.createResource<Invoice>({
          resourceType: 'Invoice',
          status: 'issued',
          subject: createReference(patient),
          date: new Date().toISOString(),
          ...(chargeItems?.length
            ? { lineItem: chargeItems.map((item) => ({ chargeItemReference: createReference(item) })) }
            : undefined),
          totalGross: { value: amount, currency: invoiceCurrency },
        }));

      const base = window.location.href.split('?')[0];
      // FHIR validation rejects empty-string primitives, so the optional payer
      // email must be omitted entirely when blank.
      const trimmedEmail = payerEmail.trim();
      const params: Parameters = {
        resourceType: 'Parameters',
        parameter: [
          { name: 'method', valueString: 'card' },
          { name: 'currency', valueString: presentmentCurrency },
          { name: 'successUrl', valueString: `${base}?payment=success&invoice=${targetInvoice.id}` },
          { name: 'cancelUrl', valueString: `${base}?payment=cancel` },
          ...(trimmedEmail ? [{ name: 'payerEmail', valueString: trimmedEmail }] : []),
          { name: 'amount', valueMoney: { value: amount, currency: invoiceCurrency } },
        ],
      };

      const response: Parameters = await medplum.post(
        medplum.fhirUrl('Invoice', targetInvoice.id as string, '$checkout'),
        params
      );

      const checkoutUrl = response.parameter?.find((p) => p.name === 'checkoutUrl')?.valueString;
      if (!checkoutUrl) {
        setStatus('failed');
        setMessage('Could not start the card checkout. Try again.');
        return;
      }

      // Hand off to Stripe's hosted page. On return the success effect above polls.
      window.location.assign(checkoutUrl);
    } catch (err) {
      setStatus('failed');
      setMessage(normalizeErrorString(err));
    }
  }

  return (
    <Stack gap="sm">
      <NumberInput
        label="Amount"
        value={amount}
        onChange={(v) => setAmount(typeof v === 'number' ? v : undefined)}
        min={0}
        disabled={busy || Boolean(invoice)}
        suffix={` ${invoiceCurrency}`}
        thousandSeparator=" "
      />
      <Select
        label="Charge currency"
        description="The payer is charged in this currency; the invoice stays in XAF."
        data={PRESENTMENT_CURRENCIES}
        value={presentmentCurrency}
        onChange={(v) => setPresentmentCurrency(v ?? invoiceCurrency)}
        allowDeselect={false}
        disabled={busy}
      />
      <TextInput
        label="Payer email"
        placeholder="payer@example.com"
        type="email"
        value={payerEmail}
        onChange={(e) => setPayerEmail(e.currentTarget.value)}
        disabled={busy}
      />

      {message && (
        <Alert color={alertColor(status)} variant="light">
          {message}
        </Alert>
      )}

      <Button onClick={handleCheckout} loading={busy} disabled={status === 'completed'}>
        {status === 'completed' ? 'Paid' : 'Pay by card'}
      </Button>
      {invoice?.id && (
        <Text size="xs" c="dimmed">
          You will be redirected to Stripe to complete the payment securely.
        </Text>
      )}
    </Stack>
  );
}

function alertColor(status: CardStatus): string {
  if (status === 'failed') {
    return 'red';
  }
  return status === 'completed' ? 'green' : 'blue';
}
