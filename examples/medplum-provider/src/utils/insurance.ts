// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { createReference } from '@medplum/core';
import type {
  Claim,
  Coverage,
  Invoice,
  Money,
  Organization,
  Patient,
  Practitioner,
  Reference,
} from '@medplum/fhirtypes';
import type { MedplumClient } from '@medplum/core';

/** Organization.type code marking a payer/insurance company. */
export const INSURER_TYPE = 'ins';

/**
 * Cameroon insurance is largely co-pay based: a private insurer or mutuelle covers
 * a share of the bill and the patient pays the remainder (typically via mobile money).
 * This module derives that split from the patient's FHIR Coverage and records the
 * insurer's share as a Claim.
 */

export interface CoPaySplit {
  total: Money;
  /** Amount the patient pays out of pocket. */
  patientPortion: Money;
  /** Amount billed to the insurer. */
  insurerPortion: Money;
  /** Patient's share as a whole percentage. */
  patientPercent: number;
  coverage?: Coverage;
}

/**
 * Splits an invoice total between patient and insurer based on the patient's Coverage.
 *
 * Cost-sharing is read from `Coverage.costToBeneficiary`:
 * - a fixed amount (`valueMoney`) is treated as a flat co-pay, or
 * - a percentage (`valueQuantity`) is treated as the patient's coinsurance share.
 * With no coverage (or no cost-sharing specified) the patient pays the full amount.
 * @param total - The full amount due.
 * @param coverage - The patient's active coverage, if any.
 * @returns The patient/insurer split.
 */
export function computeCoPay(total: Money, coverage?: Coverage): CoPaySplit {
  const currency = total.currency ?? 'XAF';
  const totalValue = total.value ?? 0;

  if (!coverage) {
    return {
      total,
      patientPortion: { value: totalValue, currency },
      insurerPortion: { value: 0, currency },
      patientPercent: 100,
    };
  }

  const fixedCopay = coverage.costToBeneficiary?.find((c) => c.valueMoney?.value !== undefined)?.valueMoney;
  const coinsurancePercent = coverage.costToBeneficiary?.find((c) => c.valueQuantity?.value !== undefined)?.valueQuantity
    ?.value;

  let patientValue: number;
  if (fixedCopay?.value !== undefined) {
    patientValue = Math.min(fixedCopay.value, totalValue);
  } else if (coinsurancePercent !== undefined) {
    patientValue = Math.round((totalValue * coinsurancePercent) / 100);
  } else {
    // Coverage on file but no cost-sharing specified — collect full from patient; staff can adjust.
    patientValue = totalValue;
  }

  const insurerValue = Math.max(0, totalValue - patientValue);
  const patientPercent = totalValue > 0 ? Math.round((patientValue / totalValue) * 100) : 100;

  return {
    total,
    patientPortion: { value: patientValue, currency },
    insurerPortion: { value: insurerValue, currency },
    patientPercent,
    coverage,
  };
}

/** Loads the patient's most recent active Coverage, if any. */
export async function getActiveCoverage(medplum: MedplumClient, patient: Patient): Promise<Coverage | undefined> {
  const results = await medplum.searchResources(
    'Coverage',
    `beneficiary=Patient/${patient.id}&status=active&_sort=-_lastUpdated&_count=1`
  );
  return results[0];
}

/** All active Coverages for a patient. */
export async function getPatientCoverages(medplum: MedplumClient, patient: Patient): Promise<Coverage[]> {
  return medplum.searchResources('Coverage', `beneficiary=Patient/${patient.id}&status=active&_count=50`);
}

/** Loads the configured insurance payers (Organizations of type "ins"). */
export async function getInsurers(medplum: MedplumClient): Promise<Organization[]> {
  return medplum.searchResources('Organization', `type=${INSURER_TYPE}&active=true&_sort=name&_count=100`);
}

/**
 * Creates an active Coverage linking a patient to an insurer, with the patient's
 * coinsurance share recorded on `costToBeneficiary` so the co-pay split can be derived.
 * @param medplum - The Medplum client.
 * @param patient - The covered patient.
 * @param payor - The insurer Organization.
 * @param subscriberId - The member/subscriber id with the insurer.
 * @param patientCoinsurancePercent - The patient's out-of-pocket share, as a percentage.
 * @returns The created Coverage.
 */
export async function createCoverage(
  medplum: MedplumClient,
  patient: Patient,
  payor: Organization,
  subscriberId: string,
  patientCoinsurancePercent: number
): Promise<Coverage> {
  return medplum.createResource<Coverage>({
    resourceType: 'Coverage',
    status: 'active',
    beneficiary: createReference(patient),
    subscriber: createReference(patient),
    subscriberId: subscriberId || undefined,
    relationship: {
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/subscriber-relationship', code: 'self' }],
    },
    payor: [createReference(payor)],
    costToBeneficiary: [
      {
        type: {
          coding: [{ system: 'http://terminology.hl7.org/CodeSystem/coverage-copay-type', code: 'coinsurance' }],
        },
        valueQuantity: {
          value: patientCoinsurancePercent,
          unit: '%',
          system: 'http://unitsofmeasure.org',
          code: '%',
        },
      },
    ],
  });
}

/**
 * Records the insurer's share of a bill as a FHIR Claim against the patient's Coverage.
 * @param medplum - The Medplum client.
 * @param patient - The patient.
 * @param coverage - The coverage to claim against.
 * @param amount - The insurer portion.
 * @param invoice - Optional originating invoice, referenced for traceability.
 * @returns The created Claim.
 */
export async function createInsurerClaim(
  medplum: MedplumClient,
  patient: Patient,
  coverage: Coverage,
  amount: Money,
  invoice?: Invoice
): Promise<Claim> {
  const profile = medplum.getProfile();
  const provider = (profile ? createReference(profile) : createReference(patient)) as Reference<Practitioner>;

  return medplum.createResource<Claim>({
    resourceType: 'Claim',
    status: 'active',
    type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/claim-type', code: 'institutional' }] },
    use: 'claim',
    patient: createReference(patient),
    created: new Date().toISOString(),
    provider,
    priority: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/processpriority', code: 'normal' }] },
    insurance: [{ sequence: 1, focal: true, coverage: createReference(coverage) }],
    total: amount,
    ...(invoice ? { identifier: invoice.identifier } : {}),
  });
}
