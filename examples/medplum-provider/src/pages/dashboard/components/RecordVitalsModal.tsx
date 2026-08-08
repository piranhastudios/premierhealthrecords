// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Button, Group, Modal, NumberInput, SimpleGrid, Stack, Text } from '@mantine/core';
import { createReference, getReferenceString } from '@medplum/core';
import type { Observation, ObservationComponent } from '@medplum/fhirtypes';
import { useMedplum, useMedplumProfile } from '@medplum/react';
import { IconHeartbeat } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useState } from 'react';
import { showErrorNotification, showSuccessNotification } from '../../../utils/notifications';

const LOINC = 'http://loinc.org';
const UCUM = 'http://unitsofmeasure.org';
const VITAL_SIGNS_CATEGORY = {
  coding: [
    {
      system: 'http://terminology.hl7.org/CodeSystem/observation-category',
      code: 'vital-signs',
      display: 'Vital Signs',
    },
  ],
};

/** One numeric field in the vitals form, mapped to the LOINC code it writes. */
interface VitalField {
  key: string;
  label: string;
  unit: string;
  ucum: string;
  loincCode: string;
  loincDisplay: string;
  min: number;
  max: number;
  decimals?: number;
}

// Codes mirror `vitals.utils.ts` (and the @medplum/react vitals form) so the
// overview charts pick these readings up.
const FIELDS: VitalField[] = [
  { key: 'hr', label: 'Heart Rate', unit: 'bpm', ucum: '/min', loincCode: '8867-4', loincDisplay: 'Heart rate', min: 20, max: 300 },
  { key: 'temp', label: 'Temperature', unit: '°C', ucum: 'Cel', loincCode: '8310-5', loincDisplay: 'Body temperature', min: 30, max: 45, decimals: 1 },
  { key: 'rr', label: 'Resp. Rate', unit: '/min', ucum: '/min', loincCode: '9279-1', loincDisplay: 'Respiratory rate', min: 4, max: 80 },
  { key: 'spo2', label: 'Oxygen Sat.', unit: '%', ucum: '%', loincCode: '2708-6', loincDisplay: 'Oxygen saturation', min: 40, max: 100 },
  { key: 'weight', label: 'Weight', unit: 'kg', ucum: 'kg', loincCode: '29463-7', loincDisplay: 'Body weight', min: 1, max: 400, decimals: 1 },
];

export interface RecordVitalsModalProps {
  opened: boolean;
  onClose: () => void;
  /** The patient the vitals are for. */
  patientRef: string | undefined;
  patientName: string | undefined;
  /** The visit's appointment id, used to link readings to its encounter. */
  appointmentId: string | undefined;
  /** Called after the observations are saved. */
  onRecorded: () => void;
}

/**
 * Nurses-station vitals capture: quick numeric entry for BP, heart rate,
 * temperature, respiratory rate, SpO2, and weight. Saving creates one
 * vital-signs Observation per filled field (blood pressure as a single panel
 * with systolic/diastolic components), stamped with the current time, the
 * signed-in performer, and the visit's encounter when one exists.
 *
 * @param props - Patient/appointment context and open/close handlers.
 * @returns The modal.
 */
export function RecordVitalsModal(props: RecordVitalsModalProps): JSX.Element {
  const { opened, onClose, patientRef, patientName, appointmentId, onRecorded } = props;
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const [values, setValues] = useState<Record<string, number | string>>({});
  const [saving, setSaving] = useState(false);

  const setValue = (key: string, value: number | string): void => setValues((prev) => ({ ...prev, [key]: value }));

  const numeric = (key: string): number | undefined => {
    const value = values[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  };

  const systolic = numeric('systolic');
  const diastolic = numeric('diastolic');
  const hasAnyValue = systolic !== undefined || diastolic !== undefined || FIELDS.some((f) => numeric(f.key) !== undefined);

  const handleClose = (): void => {
    setValues({});
    onClose();
  };

  const handleSave = async (): Promise<void> => {
    if (!patientRef || !hasAnyValue) {
      return;
    }
    setSaving(true);
    try {
      // Link readings to the visit's encounter when the visit has been started.
      const encounter = appointmentId
        ? await medplum.searchOne('Encounter', [['appointment', `Appointment/${appointmentId}`]]).catch(() => undefined)
        : undefined;

      const now = new Date().toISOString();
      const base: Omit<Observation, 'code'> = {
        resourceType: 'Observation',
        status: 'final',
        category: [VITAL_SIGNS_CATEGORY],
        subject: { reference: patientRef },
        effectiveDateTime: now,
        ...(profile && { performer: [createReference(profile)] }),
        ...(encounter && { encounter: { reference: getReferenceString(encounter) } }),
      };

      const observations: Observation[] = [];

      if (systolic !== undefined || diastolic !== undefined) {
        const components: ObservationComponent[] = [];
        if (systolic !== undefined) {
          components.push({
            code: { coding: [{ system: LOINC, code: '8480-6', display: 'Systolic blood pressure' }] },
            valueQuantity: { value: systolic, unit: 'mmHg', system: UCUM, code: 'mm[Hg]' },
          });
        }
        if (diastolic !== undefined) {
          components.push({
            code: { coding: [{ system: LOINC, code: '8462-4', display: 'Diastolic blood pressure' }] },
            valueQuantity: { value: diastolic, unit: 'mmHg', system: UCUM, code: 'mm[Hg]' },
          });
        }
        observations.push({
          ...base,
          code: { coding: [{ system: LOINC, code: '85354-9', display: 'Blood pressure panel' }] },
          component: components,
        });
      }

      for (const field of FIELDS) {
        const value = numeric(field.key);
        if (value === undefined) {
          continue;
        }
        observations.push({
          ...base,
          code: { coding: [{ system: LOINC, code: field.loincCode, display: field.loincDisplay }] },
          valueQuantity: { value, unit: field.unit, system: UCUM, code: field.ucum },
        });
      }

      await Promise.all(observations.map((obs) => medplum.createResource(obs)));
      showSuccessNotification({
        title: 'Vitals recorded',
        message: `${observations.length} reading${observations.length === 1 ? '' : 's'} saved for ${patientName ?? 'patient'}`,
        icon: <IconHeartbeat size={16} />,
      });
      setValues({});
      onRecorded();
      onClose();
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened={opened} onClose={handleClose} title={<Text fw={600}>Record vitals — {patientName ?? 'Patient'}</Text>} size="lg">
      <Stack gap="md">
        <div>
          <Text size="sm" fw={500} mb={4}>
            Blood Pressure (mmHg)
          </Text>
          <Group grow>
            <NumberInput
              label="Systolic"
              placeholder="120"
              min={40}
              max={300}
              value={values.systolic ?? ''}
              onChange={(v) => setValue('systolic', v)}
            />
            <NumberInput
              label="Diastolic"
              placeholder="80"
              min={20}
              max={200}
              value={values.diastolic ?? ''}
              onChange={(v) => setValue('diastolic', v)}
            />
          </Group>
        </div>
        <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="sm">
          {FIELDS.map((field) => (
            <NumberInput
              key={field.key}
              label={`${field.label} (${field.unit})`}
              min={field.min}
              max={field.max}
              decimalScale={field.decimals ?? 0}
              value={values[field.key] ?? ''}
              onChange={(v) => setValue(field.key, v)}
            />
          ))}
        </SimpleGrid>
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button color="brand" onClick={handleSave} loading={saving} disabled={!hasAnyValue || !patientRef}>
            Save vitals
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
