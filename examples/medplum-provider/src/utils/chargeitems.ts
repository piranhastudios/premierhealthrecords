// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient, WithId } from '@medplum/core';
import { createReference, getReferenceString } from '@medplum/core';
import type { ChargeItem, Encounter, Patient } from '@medplum/fhirtypes';

/**
 * Standalone function to fetch and apply ChargeItemDefinition to charge item
 * @param medplum - Medplum client instance
 * @param chargeItem - Current charge item
 * @returns Promise with updated charge items
 */
export async function applyChargeItemDefinition(
  medplum: MedplumClient,
  chargeItem: WithId<ChargeItem>
): Promise<WithId<ChargeItem>> {
  if (!chargeItem.definitionCanonical || chargeItem.definitionCanonical.length === 0) {
    return chargeItem;
  }

  const searchResult = await medplum.searchResources(
    'ChargeItemDefinition',
    `url=${chargeItem.definitionCanonical[0]}`
  );

  if (searchResult.length === 0) {
    return chargeItem;
  }

  const chargeItemDefinition = searchResult[0];
  const applyResult = await medplum.post(medplum.fhirUrl('ChargeItemDefinition', chargeItemDefinition.id, '$apply'), {
    resourceType: 'Parameters',
    parameter: [
      {
        name: 'chargeItem',
        valueReference: createReference(chargeItem),
      },
    ],
  });

  return applyResult as WithId<ChargeItem>;
}

export async function getChargeItemsForEncounter(
  medplum: MedplumClient,
  encounter: Encounter
): Promise<WithId<ChargeItem>[]> {
  if (!encounter) {
    return [];
  }

  const chargeItems = await medplum.searchResources('ChargeItem', `context=${getReferenceString(encounter)}`);
  const updatedChargeItems = await Promise.all(
    chargeItems.map((chargeItem) => applyChargeItemDefinition(medplum, chargeItem))
  );
  return updatedChargeItems;
}

/**
 * Fetches a patient's open (planned or billable, i.e. not yet invoiced) ChargeItems.
 * Checkout attaches these as Invoice.lineItem references so the
 * premierhealth-release-paid-tasks bot can find and release the pay-gated tasks
 * those charges are blocking once the invoice balances.
 * @param medplum - Medplum client instance
 * @param patient - The patient being checked out
 * @returns Promise with the patient's open charge items
 */
export async function getOpenChargeItemsForPatient(
  medplum: MedplumClient,
  patient: Patient
): Promise<WithId<ChargeItem>[]> {
  // ChargeItem has NO `status` search parameter in FHIR R4 — a `status=` filter
  // makes the whole search 400 — so filter client-side.
  const items = await medplum.searchResources('ChargeItem', `subject=${getReferenceString(patient)}&_count=100`);
  return items.filter((item) => item.status === 'planned' || item.status === 'billable');
}

export function calculateTotalPrice(items: ChargeItem[]): number {
  return items.reduce((sum, item) => sum + (item.priceOverride?.value || 0), 0);
}
