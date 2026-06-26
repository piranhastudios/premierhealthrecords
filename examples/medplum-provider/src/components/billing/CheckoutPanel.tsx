// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Alert, Badge, Button, Divider, Group, NumberInput, Select, Stack, Text, TextInput } from '@mantine/core';
import { getReferenceString, normalizeErrorString } from '@medplum/core';
import type { Coverage, Organization, Patient } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  computeCoPay,
  createCoverage,
  createInsurerClaim,
  getInsurers,
  getPatientCoverages,
} from '../../utils/insurance';
import { PaymentCollection } from './PaymentCollection';

const DEFAULT_CURRENCY = 'XAF';
const SELF_PAY = 'self';
const DEFAULT_COPAY_PERCENT = 20;

export interface CheckoutPanelProps {
  patient: Patient;
  onPaid?: () => void;
}

/**
 * Front-desk / end-of-visit checkout. The patient either pays as you go (full
 * amount via mobile money) or bills an insurer: pick the payer, apply the co-pay
 * split, collect the patient portion via mobile money, and record the insurer's
 * share as a Claim (creating the Coverage on the fly if needed).
 */
export function CheckoutPanel(props: CheckoutPanelProps): JSX.Element {
  const { patient, onPaid } = props;
  const medplum = useMedplum();

  const [total, setTotal] = useState<number | undefined>();
  const [insurers, setInsurers] = useState<Organization[]>([]);
  const [coverages, setCoverages] = useState<Coverage[]>([]);
  const [payer, setPayer] = useState<string>(SELF_PAY);
  const [subscriberId, setSubscriberId] = useState('');
  const [copayPercent, setCopayPercent] = useState<number>(DEFAULT_COPAY_PERCENT);

  const [claimBusy, setClaimBusy] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [claimMessage, setClaimMessage] = useState<string>();

  const loadCoverages = useCallback(() => {
    getPatientCoverages(medplum, patient).then(setCoverages).catch(console.error);
  }, [medplum, patient]);

  useEffect(() => {
    getInsurers(medplum).then(setInsurers).catch(console.error);
    loadCoverages();
  }, [medplum, loadCoverages]);

  const selectedInsurer = insurers.find((o) => o.id === payer);
  const existingCoverage = coverages.find((c) => c.payor?.some((p) => p.reference === `Organization/${payer}`));

  // Resolve the coverage that drives the split: none for self-pay, the existing
  // Coverage if one is on file, otherwise a transient one from the entered co-pay.
  const effectiveCoverage = useMemo<Coverage | undefined>(() => {
    if (payer === SELF_PAY) {
      return undefined;
    }
    if (existingCoverage) {
      return existingCoverage;
    }
    return {
      resourceType: 'Coverage',
      status: 'active',
      beneficiary: { reference: getReferenceString(patient) },
      payor: [],
      costToBeneficiary: [{ valueQuantity: { value: copayPercent } }],
    } as Coverage;
  }, [payer, existingCoverage, copayPercent, patient]);

  const split = useMemo(
    () => computeCoPay({ value: total ?? 0, currency: DEFAULT_CURRENCY }, effectiveCoverage),
    [total, effectiveCoverage]
  );

  const payerOptions = useMemo(
    () => [
      { value: SELF_PAY, label: 'Self-pay (pay as you go)' },
      ...insurers.map((o) => ({ value: o.id as string, label: o.name ?? 'Insurer' })),
    ],
    [insurers]
  );

  async function handleRecordClaim(): Promise<void> {
    if (!selectedInsurer || !split.insurerPortion.value) {
      return;
    }
    setClaimBusy(true);
    setClaimMessage(undefined);
    try {
      let coverage = existingCoverage;
      if (!coverage) {
        coverage = await createCoverage(medplum, patient, selectedInsurer, subscriberId, copayPercent);
        loadCoverages();
      }
      await createInsurerClaim(medplum, patient, coverage, split.insurerPortion);
      setClaimed(true);
      setClaimMessage(`Claim sent to ${selectedInsurer.name}.`);
    } catch (err) {
      setClaimMessage(normalizeErrorString(err));
    } finally {
      setClaimBusy(false);
    }
  }

  const isInsurer = payer !== SELF_PAY;

  return (
    <Stack gap="md">
      <Select
        label="Payer"
        data={payerOptions}
        value={payer}
        onChange={(v) => {
          setPayer(v ?? SELF_PAY);
          setClaimed(false);
          setClaimMessage(undefined);
        }}
        allowDeselect={false}
      />

      {isInsurer && !existingCoverage && (
        <Group grow>
          <TextInput
            label="Subscriber / member ID"
            value={subscriberId}
            onChange={(e) => setSubscriberId(e.currentTarget.value)}
          />
          <NumberInput
            label="Patient co-pay"
            value={copayPercent}
            onChange={(v) => setCopayPercent(typeof v === 'number' ? v : 0)}
            min={0}
            max={100}
            suffix="%"
          />
        </Group>
      )}
      {isInsurer && existingCoverage && (
        <Text size="sm" c="dimmed">
          Using coverage on file{existingCoverage.subscriberId ? ` (member ${existingCoverage.subscriberId})` : ''}.
        </Text>
      )}

      <NumberInput
        label="Amount due"
        value={total}
        onChange={(v) => setTotal(typeof v === 'number' ? v : undefined)}
        min={0}
        suffix={` ${DEFAULT_CURRENCY}`}
        thousandSeparator=" "
      />

      {isInsurer && total !== undefined && total > 0 && (
        <Alert variant="light" color="blue">
          <Group justify="space-between">
            <Text size="sm">
              {selectedInsurer?.name} covers {split.insurerPortion.value?.toLocaleString()} {DEFAULT_CURRENCY}
            </Text>
            <Badge color="blue" variant="light">
              Patient pays {split.patientPercent}%
            </Badge>
          </Group>
        </Alert>
      )}

      <Divider label="Patient payment" labelPosition="left" />
      <PaymentCollection patient={patient} defaultAmount={split.patientPortion} onPaid={onPaid} />

      {isInsurer && (split.insurerPortion.value ?? 0) > 0 && (
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
              : `Bill ${selectedInsurer?.name} (${split.insurerPortion.value?.toLocaleString()} ${DEFAULT_CURRENCY})`}
          </Button>
        </>
      )}
    </Stack>
  );
}
