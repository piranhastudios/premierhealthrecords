// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Card, Group, NumberInput, Select, Text, TextInput } from '@mantine/core';
import type { Organization } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { getInsurers } from '../../utils/insurance';

/** Insurance details captured (optionally) during patient registration. */
export interface InsuranceSelection {
  /** The selected insurer, or undefined for self-pay. */
  insurer?: Organization;
  /** The member/subscriber id with the insurer. */
  subscriberId: string;
  /** The patient's out-of-pocket share, as a percentage. */
  copayPercent: number;
}

const SELF_PAY = 'self';
const DEFAULT_COPAY_PERCENT = 20;

export interface InsuranceStepProps {
  /** Called whenever the selection changes. */
  readonly onChange: (selection: InsuranceSelection) => void;
}

/**
 * Optional insurance capture for patient registration: an insurer picker
 * constrained to the configured payers (`Organization?type=ins`), plus the
 * subscriber id and co-pay share used to create the Coverage. Mirrors the
 * checkout panel so the two flows stay consistent.
 *
 * @param props - Step inputs.
 * @param props.onChange - Called with the current selection whenever it changes.
 * @returns The insurance step card.
 */
export function InsuranceStep({ onChange }: InsuranceStepProps): JSX.Element {
  const medplum = useMedplum();
  const [insurers, setInsurers] = useState<Organization[]>([]);
  const [payer, setPayer] = useState<string>(SELF_PAY);
  const [subscriberId, setSubscriberId] = useState('');
  const [copayPercent, setCopayPercent] = useState<number>(DEFAULT_COPAY_PERCENT);

  useEffect(() => {
    getInsurers(medplum).then(setInsurers).catch(console.error);
  }, [medplum]);

  useEffect(() => {
    onChange({
      insurer: insurers.find((o) => o.id === payer),
      subscriberId,
      copayPercent,
    });
  }, [onChange, insurers, payer, subscriberId, copayPercent]);

  const payerOptions = useMemo(
    () => [
      { value: SELF_PAY, label: 'Self-pay (no insurance)' },
      ...insurers.map((o) => ({ value: o.id as string, label: o.name ?? 'Insurer' })),
    ],
    [insurers]
  );

  return (
    <Card withBorder radius="md" p="md">
      <Text fw={600} mb={4}>
        Insurance
      </Text>
      <Text size="xs" c="dimmed" mb="sm">
        Optional — can also be added later from the patient's chart.
      </Text>
      <Select
        label="Payer"
        data={payerOptions}
        value={payer}
        onChange={(v) => setPayer(v ?? SELF_PAY)}
        allowDeselect={false}
      />
      {payer !== SELF_PAY && (
        <Group grow mt="sm">
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
    </Card>
  );
}
