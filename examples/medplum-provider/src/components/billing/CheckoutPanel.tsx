// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Alert, Badge, Button, Divider, Group, NumberInput, Stack, Text } from '@mantine/core';
import { normalizeErrorString } from '@medplum/core';
import type { Coverage, Patient } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { computeCoPay, createInsurerClaim, getActiveCoverage } from '../../utils/insurance';
import { PaymentCollection } from './PaymentCollection';

const DEFAULT_CURRENCY = 'XAF';

export interface CheckoutPanelProps {
  patient: Patient;
  onPaid?: () => void;
}

/**
 * Front-desk / end-of-visit checkout: enter the amount due, apply the patient's
 * insurance co-pay split, collect the patient portion via mobile money, and record
 * the insurer's share as a Claim.
 */
export function CheckoutPanel(props: CheckoutPanelProps): JSX.Element {
  const { patient, onPaid } = props;
  const medplum = useMedplum();

  const [total, setTotal] = useState<number | undefined>();
  const [coverage, setCoverage] = useState<Coverage | undefined>();
  const [claimMessage, setClaimMessage] = useState<string>();
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimed, setClaimed] = useState(false);

  useEffect(() => {
    getActiveCoverage(medplum, patient).then(setCoverage).catch(console.error);
  }, [medplum, patient]);

  const split = useMemo(
    () => computeCoPay({ value: total ?? 0, currency: DEFAULT_CURRENCY }, coverage),
    [total, coverage]
  );

  async function handleRecordClaim(): Promise<void> {
    if (!coverage || !split.insurerPortion.value) {
      return;
    }
    setClaimBusy(true);
    setClaimMessage(undefined);
    try {
      await createInsurerClaim(medplum, patient, coverage, split.insurerPortion);
      setClaimed(true);
      setClaimMessage('Insurer claim recorded.');
    } catch (err) {
      setClaimMessage(normalizeErrorString(err));
    } finally {
      setClaimBusy(false);
    }
  }

  const payorName = coverage?.payor?.find((p) => p.display)?.display ?? 'Insurer';

  return (
    <Stack gap="md">
      <NumberInput
        label="Amount due"
        value={total}
        onChange={(v) => setTotal(typeof v === 'number' ? v : undefined)}
        min={0}
        suffix={` ${DEFAULT_CURRENCY}`}
        thousandSeparator=" "
      />

      {coverage && total !== undefined && total > 0 && (
        <Alert variant="light" color="blue">
          <Group justify="space-between">
            <Text size="sm">
              {payorName}: covers {split.insurerPortion.value?.toLocaleString()} {DEFAULT_CURRENCY}
            </Text>
            <Badge color="blue" variant="light">
              Patient pays {split.patientPercent}%
            </Badge>
          </Group>
        </Alert>
      )}

      <Divider label="Patient payment" labelPosition="left" />
      <PaymentCollection patient={patient} defaultAmount={split.patientPortion} onPaid={onPaid} />

      {coverage && (split.insurerPortion.value ?? 0) > 0 && (
        <>
          <Divider label="Insurance" labelPosition="left" />
          {claimMessage && (
            <Alert variant="light" color={claimed ? 'green' : 'red'}>
              {claimMessage}
            </Alert>
          )}
          <Button variant="light" onClick={handleRecordClaim} loading={claimBusy} disabled={claimed}>
            {claimed
              ? 'Claim recorded'
              : `Record insurer claim (${split.insurerPortion.value?.toLocaleString()} ${DEFAULT_CURRENCY})`}
          </Button>
        </>
      )}
    </Stack>
  );
}
