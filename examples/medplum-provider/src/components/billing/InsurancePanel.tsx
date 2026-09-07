// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Alert, Badge, Button, Card, Group, Loader, NumberInput, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import type { WithId } from '@medplum/core';
import type { Coverage, Organization, Patient } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { IconAlertCircle, IconShieldCheck } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { canWriteResource } from '../../hooks/useUserRole';
import { createSelfPayCoverage, isSelfPayCoverage } from '../../utils/coverage';
import { createCoverage, getInsurers, getPatientCoverages } from '../../utils/insurance';
import { showErrorNotification, showSuccessNotification } from '../../utils/notifications';

const SELF_PAY = 'self';
const DEFAULT_COPAY_PERCENT = 20;

/** The patient's share, read back off `costToBeneficiary`. */
export function getCoinsurancePercent(coverage: Coverage): number | undefined {
  for (const cost of coverage.costToBeneficiary ?? []) {
    if (cost.valueQuantity?.code === '%' && typeof cost.valueQuantity.value === 'number') {
      return cost.valueQuantity.value;
    }
  }
  return undefined;
}

function describe(coverage: WithId<Coverage>): string {
  if (isSelfPayCoverage(coverage)) {
    return 'Self-pay';
  }
  return coverage.payor?.[0]?.display ?? coverage.type?.text ?? 'Insurer';
}

/**
 * The patient's insurance, and how to change it.
 *
 * Insurance is captured during registration, but cover changes: people switch
 * insurer, join a scheme, or lose one. Saving a new arrangement cancels the
 * previous Coverage rather than editing it, so the record of what applied when a
 * past invoice was raised stays intact.
 *
 * @param props - The patient whose cover is shown.
 * @returns The insurance panel.
 */
export function InsurancePanel(props: { patient: Patient }): JSX.Element {
  const { patient } = props;
  const medplum = useMedplum();
  const canEdit = canWriteResource(medplum.getAccessPolicy(), 'Coverage');
  const [coverages, setCoverages] = useState<WithId<Coverage>[] | undefined>();
  const [insurers, setInsurers] = useState<Organization[]>([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [insurerId, setInsurerId] = useState<string>(SELF_PAY);
  const [subscriberId, setSubscriberId] = useState('');
  const [copayPercent, setCopayPercent] = useState<number>(DEFAULT_COPAY_PERCENT);

  const load = useCallback(() => {
    if (!patient.id) {
      return;
    }
    getPatientCoverages(medplum, patient)
      .then((found) => setCoverages(found as WithId<Coverage>[]))
      .catch((error: unknown) => {
        showErrorNotification(error);
        setCoverages([]);
      });
  }, [medplum, patient]);

  useEffect(load, [load]);

  useEffect(() => {
    if (editing && insurers.length === 0) {
      getInsurers(medplum).then(setInsurers).catch(showErrorNotification);
    }
  }, [editing, insurers.length, medplum]);

  const save = useCallback(async () => {
    if (!patient.id) {
      return;
    }
    setSaving(true);
    try {
      // Retire what was there. Cancelling rather than deleting keeps the history of
      // which cover applied to invoices already raised.
      for (const existing of coverages ?? []) {
        await medplum.updateResource({ ...existing, status: 'cancelled' });
      }
      if (insurerId === SELF_PAY) {
        await createSelfPayCoverage(medplum, patient as WithId<Patient>);
      } else {
        const payor = insurers.find((i) => i.id === insurerId);
        if (!payor) {
          showErrorNotification('Choose an insurer.');
          setSaving(false);
          return;
        }
        await createCoverage(medplum, patient, payor, subscriberId.trim(), copayPercent);
      }
      showSuccessNotification({ message: 'Insurance updated' });
      setEditing(false);
      load();
    } catch (error) {
      showErrorNotification(error);
    } finally {
      setSaving(false);
    }
  }, [medplum, patient, coverages, insurerId, insurers, subscriberId, copayPercent, load]);

  if (!coverages) {
    return (
      <Card withBorder>
        <Loader size="sm" />
      </Card>
    );
  }

  return (
    <Card withBorder>
      <Stack gap="md">
        <Group justify="space-between" align="center">
          <Group gap="xs">
            <IconShieldCheck size={18} />
            <Title order={4}>Insurance</Title>
          </Group>
          {canEdit && !editing && (
            <Button
              size="xs"
              variant="light"
              onClick={() => {
                const current = coverages[0];
                const currentInsurer = current && !isSelfPayCoverage(current) ? current.payor?.[0]?.reference?.split('/')[1] : undefined;
                setInsurerId(currentInsurer ?? SELF_PAY);
                setSubscriberId(current?.subscriberId ?? '');
                setCopayPercent((current && getCoinsurancePercent(current)) ?? DEFAULT_COPAY_PERCENT);
                setEditing(true);
              }}
            >
              {coverages.length > 0 ? 'Change' : 'Add insurance'}
            </Button>
          )}
        </Group>

        {coverages.length === 0 ? (
          <Alert color="gray" variant="light" icon={<IconAlertCircle />}>
            No insurance on file. This patient is billed as self-pay.
          </Alert>
        ) : (
          <Stack gap="xs">
            {coverages.map((coverage) => {
              const percent = getCoinsurancePercent(coverage);
              return (
                <Group key={coverage.id} justify="space-between">
                  <div>
                    <Text fw={500}>{describe(coverage)}</Text>
                    {coverage.subscriberId && (
                      <Text size="xs" c="dimmed">
                        Member {coverage.subscriberId}
                      </Text>
                    )}
                  </div>
                  <Group gap="xs">
                    {percent !== undefined && <Badge variant="light">Patient pays {percent}%</Badge>}
                    <Badge color="green" variant="light">
                      {coverage.status}
                    </Badge>
                  </Group>
                </Group>
              );
            })}
          </Stack>
        )}

        {editing && (
          <Stack gap="sm">
            <Select
              label="Insurer"
              data={[{ value: SELF_PAY, label: 'Self-pay (no insurance)' }, ...insurers.map((i) => ({ value: i.id as string, label: i.name ?? 'Insurer' }))]}
              value={insurerId}
              onChange={(value) => setInsurerId(value ?? SELF_PAY)}
              searchable
            />
            {insurerId !== SELF_PAY && (
              <>
                <TextInput
                  label="Member / subscriber number"
                  value={subscriberId}
                  onChange={(e) => setSubscriberId(e.currentTarget.value)}
                  placeholder="As printed on the card"
                />
                <NumberInput
                  label="Patient's share"
                  description="The percentage the patient pays; the insurer is billed the rest."
                  value={copayPercent}
                  onChange={(value) => setCopayPercent(typeof value === 'number' ? value : DEFAULT_COPAY_PERCENT)}
                  min={0}
                  max={100}
                  suffix="%"
                />
              </>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={save} loading={saving}>
                Save
              </Button>
            </Group>
          </Stack>
        )}
      </Stack>
    </Card>
  );
}
