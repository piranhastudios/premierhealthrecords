// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * System-level `$qbo-pull-pricing` operation: pull the QuickBooks Online Item
 * list (the finance team's price list) into the EHR service catalog as
 * ChargeItemDefinition resources.
 *
 * QBO is the source of truth for pricing (docs/quickbooks-integration.md §6.1);
 * the EHR never writes prices back. The design doc calls the target resource
 * "ChargeDefinition" — the actual FHIR R4 resource is ChargeItemDefinition
 * (whose propertyGroup/priceComponent shape matches the doc exactly).
 */
import { allOk, badRequest, forbidden, Operator } from '@medplum/core';
import type { FhirRequest, FhirResponse } from '@medplum/fhir-router';
import type { ChargeItemDefinition, Money, OperationDefinition, ParametersParameter } from '@medplum/fhirtypes';
import type { QboItem, QuickBooksConfig } from '../../accounting/quickbooks';
import {
  getQuickBooksConfig,
  QBO_ITEM_ID_SYSTEM,
  QuickBooksApiError,
  QuickBooksProvider,
} from '../../accounting/quickbooks';
import { persistRotatedTokensIfAny } from '../../accounting/utils';
import { getAuthenticatedContext } from '../../context';

export const qboPullPricingOperation: OperationDefinition = {
  resourceType: 'OperationDefinition',
  id: 'qbo-pull-pricing',
  url: 'https://medplum.com/fhir/OperationDefinition/qbo-pull-pricing',
  name: 'qbo-pull-pricing',
  status: 'active',
  kind: 'operation',
  code: 'qbo-pull-pricing',
  system: true,
  type: false,
  instance: false,
  parameter: [
    { name: 'created', use: 'out', min: 1, max: '1', type: 'integer' },
    { name: 'updated', use: 'out', min: 1, max: '1', type: 'integer' },
    { name: 'total', use: 'out', min: 1, max: '1', type: 'integer' },
  ],
};

const PRICING_CURRENCY = 'XAF';

/**
 * Handles the `$qbo-pull-pricing` operation: list QBO Items and upsert a
 * ChargeItemDefinition per Item (matched by the stored QBO item identifier).
 * @param _req - The FHIR request (system-level POST).
 * @returns The FHIR response with created/updated/total counts.
 */
export async function qboPullPricingHandler(_req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();

  // Rewrites the project-wide price catalog and makes outbound QBO calls —
  // project admin only, mirroring the /accounting/quickbooks/connect gate.
  if (!ctx.repo.isSuperAdmin() && !ctx.repo.isProjectAdmin()) {
    return [forbidden];
  }

  let config: QuickBooksConfig;
  try {
    config = getQuickBooksConfig(ctx.project);
  } catch (error) {
    return [badRequest((error as Error).message)];
  }

  const provider = new QuickBooksProvider(config);
  try {
    const items = await provider.listItems();
    let created = 0;
    let updated = 0;

    for (const item of items) {
      if (!item.Id || !item.Name) {
        continue;
      }
      // Only sellable Items belong in the catalog: skip Category/Bundle rows and
      // inactive Items rather than upserting them as 0-XAF active definitions.
      if ((item.Type !== 'Service' && item.Type !== 'Inventory') || item.Active === false) {
        continue;
      }
      const existing = await ctx.repo.searchOne<ChargeItemDefinition>({
        resourceType: 'ChargeItemDefinition',
        filters: [{ code: 'identifier', operator: Operator.EQUALS, value: `${QBO_ITEM_ID_SYSTEM}|${item.Id}` }],
      });

      if (existing) {
        await ctx.repo.updateResource<ChargeItemDefinition>(applyItemPricing(existing, item));
        updated++;
      } else {
        await ctx.repo.createResource<ChargeItemDefinition>(
          applyItemPricing(
            {
              resourceType: 'ChargeItemDefinition',
              // ChargeItemDefinition.url is required in R4; derive a stable canonical from the QBO item id.
              url: `https://premierhealth.cm/fhir/ChargeItemDefinition/qbo-item-${item.Id}`,
              status: 'active',
              identifier: [{ system: QBO_ITEM_ID_SYSTEM, value: item.Id }],
            },
            item
          )
        );
        created++;
      }
    }

    const out: ParametersParameter[] = [
      { name: 'created', valueInteger: created },
      { name: 'updated', valueInteger: updated },
      { name: 'total', valueInteger: items.length },
    ];
    return [allOk, { resourceType: 'Parameters', parameter: out }];
  } catch (error) {
    if (error instanceof QuickBooksApiError && !error.retryable) {
      return [badRequest(error.message)];
    }
    throw error; // 5xx / transient — surface as a server error so callers retry.
  } finally {
    // The refresh token rotates; persist it even when the pull itself failed.
    await persistRotatedTokensIfAny(ctx.repo.getSystemRepo(), ctx.project.id, provider);
  }
}

/**
 * Copies the QBO Item's name, description, and unit price onto a
 * ChargeItemDefinition (base priceComponent in XAF).
 * @param definition - The existing or new ChargeItemDefinition.
 * @param item - The QBO Item.
 * @returns The updated ChargeItemDefinition.
 */
function applyItemPricing(definition: ChargeItemDefinition, item: QboItem): ChargeItemDefinition {
  return {
    ...definition,
    title: item.Name,
    description: item.Description,
    propertyGroup: [
      {
        priceComponent: [
          {
            type: 'base',
            amount: { value: item.UnitPrice ?? 0, currency: PRICING_CURRENCY } as Money,
          },
        ],
      },
    ],
  };
}
