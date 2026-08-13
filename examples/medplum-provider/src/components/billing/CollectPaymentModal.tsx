// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Button, Center, Divider, Group, Loader, Modal, Stack, Text } from '@mantine/core';
import type { WithId } from '@medplum/core';
import type { ChargeItem, Encounter, Patient, Reference } from '@medplum/fhirtypes';
import { CodeableConceptDisplay, useMedplum, useResource } from '@medplum/react';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { calculateTotalPrice, getChargeItemsForEncounter } from '../../utils/chargeitems';
import { PaymentCollection } from './PaymentCollection';

const CURRENCY = 'XAF';

export interface CollectPaymentModalProps {
  readonly patient: Patient;
  readonly encounter: Encounter | Reference<Encounter>;
  readonly opened: boolean;
  /** Called when the modal closes; `paid` reflects whether payment completed. */
  readonly onClose: (paid: boolean) => void;
}

/**
 * Point-of-service payment step shown right after a visit is created (and on
 * return from the card-checkout redirect): itemizes the visit's charges and
 * collects via mobile money, card, or cash through `PaymentCollection`. Once the
 * invoice balances, the pay-gated investigation tasks release automatically.
 *
 * @param props - The patient, the visit, open state, and the close callback.
 * @returns The payment modal.
 */
export function CollectPaymentModal(props: CollectPaymentModalProps): JSX.Element {
  const { patient, opened, onClose } = props;
  const medplum = useMedplum();
  const encounter = useResource(props.encounter);
  const [chargeItems, setChargeItems] = useState<WithId<ChargeItem>[]>();
  const [paid, setPaid] = useState(false);

  useEffect(() => {
    if (!opened || !encounter) {
      return () => {};
    }
    let active = true;
    getChargeItemsForEncounter(medplum, encounter)
      .then((items) => {
        if (active) {
          // Only the still-open charges: paid ones are marked 'billed'.
          setChargeItems(items.filter((item) => item.status === 'planned' || item.status === 'billable'));
        }
      })
      .catch(() => active && setChargeItems([]));
    return () => {
      active = false;
    };
  }, [medplum, encounter, opened]);

  const total = calculateTotalPrice(chargeItems ?? []);

  let body: JSX.Element;
  if (!chargeItems) {
    body = (
      <Center h={120}>
        <Loader />
      </Center>
    );
  } else if (chargeItems.length === 0 && !paid) {
    body = (
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          No open charges for this visit — nothing to collect.
        </Text>
        <Group justify="flex-end">
          <Button onClick={() => onClose(false)}>Continue to visit</Button>
        </Group>
      </Stack>
    );
  } else {
    body = (
      <Stack gap="md">
        {chargeItems.length > 0 && (
          <Stack gap={6}>
            {chargeItems.map((item) => (
              <Group key={item.id} justify="space-between" wrap="nowrap" gap="xs">
                <Text size="sm" lineClamp={1}>
                  {item.code ? <CodeableConceptDisplay value={item.code} /> : 'Charge'}
                </Text>
                <Text size="sm" fw={600} style={{ flexShrink: 0 }}>
                  {(item.priceOverride?.value ?? 0).toLocaleString()} {item.priceOverride?.currency ?? CURRENCY}
                </Text>
              </Group>
            ))}
            <Divider />
            <Group justify="space-between">
              <Text fw={700}>Total due</Text>
              <Text fw={700}>
                {total.toLocaleString()} {CURRENCY}
              </Text>
            </Group>
          </Stack>
        )}

        <PaymentCollection
          patient={patient}
          defaultAmount={{ value: total, currency: CURRENCY }}
          chargeItems={chargeItems}
          onPaid={() => setPaid(true)}
        />

        <Group justify="flex-end">
          {paid ? (
            <Button onClick={() => onClose(true)}>Continue to visit</Button>
          ) : (
            <Button variant="default" onClick={() => onClose(false)}>
              Collect later
            </Button>
          )}
        </Group>
      </Stack>
    );
  }

  return (
    <Modal
      opened={opened}
      onClose={() => onClose(paid)}
      title="Collect payment"
      size="lg"
      centered
      closeOnClickOutside={false}
    >
      {body}
    </Modal>
  );
}
