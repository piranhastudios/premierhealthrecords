// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient } from '@medplum/core';
import type { AccessPolicy } from '@medplum/fhirtypes';

/**
 * Whether the compiled access policy grants create/update on a resource type.
 * Mirrors the provider app's `canWrite` (useUserRole.ts): the compiled policy
 * marks read-only entries with BOTH `readonly: true` AND an `interaction` list,
 * so both conventions must be checked.
 *
 * @param policy - The compiled effective access policy.
 * @param resourceType - The resource type to test.
 * @returns True when the policy allows writes.
 */
function canWrite(policy: AccessPolicy, resourceType: string): boolean {
  const entries = policy.resource?.filter((r) => r.resourceType === resourceType || r.resourceType === '*') ?? [];
  return entries.some((entry) => {
    if (entry.readonly === true) {
      return false;
    }
    if (entry.interaction) {
      return entry.interaction.some((i) => i === 'update' || i === 'create');
    }
    return true;
  });
}

/**
 * Whether the signed-in user may use the campaign tools (campaign builder and
 * email templates). True for project/super admins and for users whose policy
 * grants campaign writes — i.e. the "Marketing / Outreach" policy.
 *
 * Shared so the admin app and the provider app gate their marketing surfaces
 * identically.
 *
 * @param medplum - The Medplum client.
 * @returns True when the marketing tools should be available.
 */
export function canManageCampaigns(medplum: MedplumClient): boolean {
  if (medplum.isProjectAdmin() || medplum.isSuperAdmin()) {
    return true;
  }
  const policy = medplum.getAccessPolicy();
  if (!policy) {
    // Unscoped user — full access.
    return true;
  }
  return canWrite(policy, 'PlanDefinition') && canWrite(policy, 'Group');
}
