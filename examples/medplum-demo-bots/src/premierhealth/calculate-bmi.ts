// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Auto-calculate BMI bot.
 *
 * Triggered by a Subscription on body-weight or body-height vital-sign Observations
 * (create/update). When either measurement changes, this bot fetches the patient's
 * most recent body weight and body height, computes the BMI, and upserts a single
 * BMI Observation (idempotently — it updates the existing BMI rather than creating a
 * duplicate).
 *
 * When the triggering Observation belongs to an Encounter, the bot prefers readings
 * from that same Encounter and scopes the BMI to it; otherwise it works off the most
 * recent readings and scopes the BMI by effective date (day precision).
 *
 * Saving weight and height together fires two concurrent bot executions, so the
 * upsert is a server-enforced conditional create (`If-None-Exist`) rather than
 * search-then-create: at most one BMI Observation can exist per patient + encounter
 * (or per patient + day). When the conditional create returns an existing BMI whose
 * value is stale, it is updated in place (the recalculation path).
 */

import type { BotEvent, MedplumClient } from '@medplum/core';
import { createReference, LOINC, UCUM } from '@medplum/core';
import type { Observation, Patient, Quantity, Reference } from '@medplum/fhirtypes';

// LOINC vital-sign codes.
const CODE_BODY_WEIGHT = '29463-7';
const CODE_BODY_HEIGHT = '8302-2';
const CODE_BMI = '39156-5';
const BMI_UNIT = 'kg/m2';

// Observation category (vital-signs).
const OBSERVATION_CATEGORY_SYSTEM = 'http://terminology.hl7.org/CodeSystem/observation-category';
const CATEGORY_VITAL_SIGNS = 'vital-signs';

export async function handler(medplum: MedplumClient, event: BotEvent<Observation>): Promise<Observation | undefined> {
  const trigger = event.input;
  const triggerCode = trigger.code?.coding?.find((c) => c.system === LOINC)?.code;

  // No-op unless the triggering Observation is a body weight or body height.
  if (triggerCode !== CODE_BODY_WEIGHT && triggerCode !== CODE_BODY_HEIGHT) {
    return undefined;
  }

  const subject = trigger.subject as Reference<Patient> | undefined;
  if (!subject?.reference) {
    console.log('Triggering Observation has no subject; skipping BMI calculation');
    return undefined;
  }

  const encounter = trigger.encounter;

  const weight = await findLatestReading(medplum, subject.reference, CODE_BODY_WEIGHT, encounter?.reference);
  const height = await findLatestReading(medplum, subject.reference, CODE_BODY_HEIGHT, encounter?.reference);

  // Can't compute until we have both measurements.
  if (!weight || !height) {
    return undefined;
  }

  const weightKg = toKilograms(weight.valueQuantity);
  const heightM = toMeters(height.valueQuantity);
  if (weightKg === undefined || heightM === undefined) {
    console.log('Unrecognized weight/height units; skipping BMI calculation');
    return undefined;
  }
  if (heightM <= 0) {
    console.log('Non-positive height; skipping BMI calculation');
    return undefined;
  }

  const bmi = Math.round((weightKg / (heightM * heightM)) * 10) / 10;
  const effectiveDateTime = laterEffective(weight, height);

  const bmiObservation: Observation = {
    resourceType: 'Observation',
    status: 'final',
    category: [
      {
        coding: [{ system: OBSERVATION_CATEGORY_SYSTEM, code: CATEGORY_VITAL_SIGNS, display: 'Vital Signs' }],
      },
    ],
    code: {
      coding: [{ system: LOINC, code: CODE_BMI, display: 'Body mass index (BMI) [Ratio]' }],
      text: 'Body mass index (BMI)',
    },
    subject,
    ...(encounter ? { encounter } : {}),
    effectiveDateTime,
    valueQuantity: {
      value: bmi,
      unit: BMI_UNIT,
      system: UCUM,
      code: BMI_UNIT,
    },
    derivedFrom: [createReference(height), createReference(weight)],
  };

  // Idempotency + concurrency safety: a server-enforced conditional create
  // (If-None-Exist) keyed on patient + BMI code, scoped by encounter (if present) else
  // by effective date. Concurrent executions converge on a single Observation; if it
  // already exists with a stale value, update it (the recalculation path).
  const result = await medplum.createResourceIfNoneExist(
    bmiObservation,
    bmiSearchKey(subject.reference, encounter?.reference, effectiveDateTime)
  );
  if (result.valueQuantity?.value !== bmi) {
    return medplum.updateResource({ ...bmiObservation, id: result.id });
  }
  return result;
}

// Fetches the most recent Observation for a patient with the given LOINC code. When an
// encounter is provided, an encounter-scoped reading is preferred; if none exists it
// falls back to the most recent reading overall.
async function findLatestReading(
  medplum: MedplumClient,
  subject: string,
  code: string,
  encounter: string | undefined
): Promise<Observation | undefined> {
  if (encounter) {
    const inEncounter = await medplum.searchResources('Observation', {
      subject,
      code: `${LOINC}|${code}`,
      encounter,
      _sort: '-date',
      _count: 1,
    });
    if (inEncounter[0]) {
      return inEncounter[0];
    }
  }
  const latest = await medplum.searchResources('Observation', {
    subject,
    code: `${LOINC}|${code}`,
    _sort: '-date',
    _count: 1,
  });
  return latest[0];
}

// Search key for the conditional create (`If-None-Exist`): one BMI per patient per
// encounter when the readings are encounter-scoped, else one per patient per day. The
// date key is normalized to day precision on both write and query so precision
// differences between readings cannot fork duplicate BMIs.
function bmiSearchKey(subject: string, encounter: string | undefined, effectiveDateTime: string | undefined): string {
  const key = [`subject=${subject}`, `code=${LOINC}|${CODE_BMI}`];
  if (encounter) {
    key.push(`encounter=${encounter}`);
  } else if (effectiveDateTime) {
    key.push(`date=${toDayPrecision(effectiveDateTime)}`);
  }
  return key.join('&');
}

// `2026-06-01T10:05:00Z` -> `2026-06-01`. Values already at day (or coarser) precision
// pass through unchanged.
const toDayPrecision = (dateTime: string): string => dateTime.slice(0, 10);

// Convert a weight Quantity to kilograms. Returns undefined for unrecognized units.
function toKilograms(quantity: Quantity | undefined): number | undefined {
  if (quantity?.value === undefined) {
    return undefined;
  }
  const unit = normalizeUnit(quantity);
  switch (unit) {
    case 'kg':
      return quantity.value;
    case '[lb_av]':
    case 'lb':
    case 'lbs':
      return quantity.value * 0.453592;
    default:
      return undefined;
  }
}

// Convert a height Quantity to meters. Returns undefined for unrecognized units.
function toMeters(quantity: Quantity | undefined): number | undefined {
  if (quantity?.value === undefined) {
    return undefined;
  }
  const unit = normalizeUnit(quantity);
  switch (unit) {
    case 'm':
      return quantity.value;
    case 'cm':
      return quantity.value / 100;
    case '[in_i]':
    case 'in':
      return quantity.value * 0.0254;
    default:
      return undefined;
  }
}

// Prefer the UCUM `code`, fall back to the human `unit`, lower-cased for matching.
function normalizeUnit(quantity: Quantity): string {
  return (quantity.code ?? quantity.unit ?? '').trim().toLowerCase();
}

// The later of the two source readings' effective times (used on the BMI Observation).
function laterEffective(a: Observation, b: Observation): string | undefined {
  const times = [a.effectiveDateTime, b.effectiveDateTime].filter((t): t is string => !!t);
  if (times.length === 0) {
    return new Date().toISOString();
  }
  return times.sort().at(-1);
}
