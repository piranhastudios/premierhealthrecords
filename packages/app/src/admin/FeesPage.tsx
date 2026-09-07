// SPDX-FileCopyrightText: Copyright Premier Health Centres
// SPDX-License-Identifier: Apache-2.0
import { Alert, Badge, Button, Loader, NumberInput, Stack, Table, Text, Title } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import type { WithId } from '@medplum/core';
import { deepClone, normalizeErrorString } from '@medplum/core';
import type { ChargeItemDefinition, Money } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { IconAlertCircle, IconCircleCheck } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';

/** Currencies with no minor unit — XAF is quoted in whole francs. */
const ZERO_DECIMAL = new Set(['XAF', 'XOF', 'JPY', 'KRW', 'VND', 'CLP', 'ISK']);
const DEFAULT_CURRENCY = 'XAF' as const;

/** The base price of a ChargeItemDefinition, if it has one. */
export function getBasePrice(definition: ChargeItemDefinition): Money | undefined {
  for (const group of definition.propertyGroup ?? []) {
    for (const component of group.priceComponent ?? []) {
      if (component.type === 'base' && component.amount) {
        return component.amount;
      }
    }
  }
  return definition.propertyGroup?.[0]?.priceComponent?.[0]?.amount;
}

/**
 * Return a copy with the base price set, creating the propertyGroup /
 * priceComponent when the service has never been priced. Other price components
 * (surcharges, discounts) are left untouched.
 */
export function withBasePrice(
  definition: ChargeItemDefinition,
  value: number,
  currency: Money['currency']
): ChargeItemDefinition {
  const next = deepClone(definition);
  const amount: Money = { value, currency };
  const groups = next.propertyGroup ?? [];
  for (const group of groups) {
    const component = (group.priceComponent ?? []).find((c) => c.type === 'base');
    if (component) {
      component.amount = amount;
      next.propertyGroup = groups;
      return next;
    }
  }
  if (groups.length > 0) {
    groups[0].priceComponent = [...(groups[0].priceComponent ?? []), { type: 'base', amount }];
    next.propertyGroup = groups;
    return next;
  }
  next.propertyGroup = [{ priceComponent: [{ type: 'base', amount }] }];
  return next;
}

function formatMoney(money: Money | undefined): string {
  if (money?.value === undefined) {
    return 'Not set';
  }
  const currency: string = money.currency ?? DEFAULT_CURRENCY;
  const digits = ZERO_DECIMAL.has(currency) ? 0 : 2;
  return `${money.value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${currency}`;
}

/**
 * The clinic's price list.
 *
 * Prices live on ChargeItemDefinition resources. They are what a visit is billed
 * and what the website asks a patient to pay when they book, so changing one here
 * changes both from now on. Invoices already raised keep their original price.
 *
 * A service left without a price is free to book — the website skips payment for it.
 *
 * @returns The fees admin page.
 */
export function FeesPage(): JSX.Element {
  const medplum = useMedplum();
  const canEdit = medplum.isProjectAdmin() || medplum.isSuperAdmin();
  const [definitions, setDefinitions] = useState<WithId<ChargeItemDefinition>[] | undefined>();
  const [drafts, setDrafts] = useState<Record<string, number | undefined>>({});
  const [saving, setSaving] = useState<string | undefined>();

  const load = useCallback(() => {
    medplum
      .searchResources('ChargeItemDefinition', { _count: '200', _sort: 'title' })
      .then((found) => {
        setDefinitions(found);
        setDrafts(Object.fromEntries(found.map((d) => [d.id, getBasePrice(d)?.value])));
      })
      .catch((error: unknown) => {
        showNotification({ color: 'red', message: normalizeErrorString(error) });
        setDefinitions([]);
      });
  }, [medplum]);

  useEffect(load, [load]);

  const save = useCallback(
    async (definition: WithId<ChargeItemDefinition>) => {
      const value = drafts[definition.id];
      if (value === undefined || Number.isNaN(value) || value < 0) {
        showNotification({ color: 'red', message: 'Enter a price of zero or more.' });
        return;
      }
      setSaving(definition.id);
      try {
        const currency = getBasePrice(definition)?.currency ?? DEFAULT_CURRENCY;
        const updated = (await medplum.updateResource(
          withBasePrice(definition, value, currency)
        )) as WithId<ChargeItemDefinition>;
        setDefinitions((prev) => (prev ?? []).map((d) => (d.id === updated.id ? updated : d)));
        showNotification({
          color: 'green',
          icon: <IconCircleCheck />,
          message: `${definition.title ?? 'Price'} updated`,
        });
      } catch (error) {
        showNotification({ color: 'red', message: normalizeErrorString(error) });
      } finally {
        setSaving(undefined);
      }
    },
    [medplum, drafts]
  );

  if (!definitions) {
    return <Loader />;
  }

  return (
    <Stack gap="lg">
      <Stack gap={2}>
        <Title order={2}>Fees</Title>
        <Text c="dimmed" size="sm">
          What the clinic charges for each service. This is both what a visit is billed and what the website asks for
          when a patient books. A service with no price is free to book.
        </Text>
      </Stack>

      {!canEdit && (
        <Alert color="blue" variant="light" icon={<IconAlertCircle />}>
          You can view the price list but not change it.
        </Alert>
      )}

      {definitions.length === 0 ? (
        <Alert color="yellow" variant="outline" icon={<IconAlertCircle />}>
          No prices exist yet. They are created by the reference-data seed.
        </Alert>
      ) : (
        <Table verticalSpacing="sm" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Service</Table.Th>
              <Table.Th w={110}>Status</Table.Th>
              <Table.Th w={230}>Price</Table.Th>
              {canEdit && <Table.Th w={110} />}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {definitions.map((definition) => {
              const price = getBasePrice(definition);
              const currency: string = price?.currency ?? DEFAULT_CURRENCY;
              const draft = drafts[definition.id];
              const dirty = draft !== undefined && draft !== price?.value;
              return (
                <Table.Tr key={definition.id}>
                  <Table.Td>
                    <Text fw={500}>{definition.title ?? definition.url ?? definition.id}</Text>
                    {definition.description && (
                      <Text size="xs" c="dimmed">
                        {definition.description}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={definition.status === 'active' ? 'green' : 'gray'}>
                      {definition.status ?? 'unknown'}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    {canEdit ? (
                      <NumberInput
                        aria-label={`Price for ${definition.title ?? definition.id}`}
                        value={draft ?? ''}
                        min={0}
                        step={ZERO_DECIMAL.has(currency) ? 500 : 1}
                        decimalScale={ZERO_DECIMAL.has(currency) ? 0 : 2}
                        thousandSeparator=","
                        suffix={` ${currency}`}
                        placeholder="Not set"
                        onChange={(value) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [definition.id]: typeof value === 'number' ? value : Number(value) || undefined,
                          }))
                        }
                      />
                    ) : (
                      <Text>{formatMoney(price)}</Text>
                    )}
                  </Table.Td>
                  {canEdit && (
                    <Table.Td>
                      <Button
                        size="xs"
                        variant={dirty ? 'filled' : 'default'}
                        disabled={!dirty}
                        loading={saving === definition.id}
                        onClick={() => save(definition)}
                      >
                        Save
                      </Button>
                    </Table.Td>
                  )}
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}
