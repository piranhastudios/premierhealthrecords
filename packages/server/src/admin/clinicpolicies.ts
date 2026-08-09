// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { AccessPolicy, Project } from '@medplum/fhirtypes';
import { getLogger } from '../logger';
import type { SystemRepository } from '../fhir/repo';
import frontDeskPolicy from './clinic-policies/front-desk-access-policy.json' with { type: 'json' };
import marketingPolicy from './clinic-policies/marketing-access-policy.json' with { type: 'json' };
import nursePolicy from './clinic-policies/nurse-access-policy.json' with { type: 'json' };

/**
 * The staff access policies every clinic project starts with. These JSON files
 * are the single source of truth — `scripts/seed-users.mjs` uploads the same
 * files into the stock FHIR R4 project.
 */
const CLINIC_ACCESS_POLICIES = [frontDeskPolicy, nursePolicy, marketingPolicy] as unknown as AccessPolicy[];

/**
 * Installs the default clinic access policies (front desk, nurse) into a newly
 * created project, so admins can assign staff roles from the invite dropdown
 * without a manual seeding step. Each clinic is its own Medplum project, and
 * policies are project-scoped, so every new project needs its own copies.
 *
 * Failures are logged but not thrown — a missing convenience policy must not
 * break project creation.
 *
 * @param systemRepo - The system repository.
 * @param project - The newly created project.
 */
export async function createClinicAccessPolicies(systemRepo: SystemRepository, project: Project): Promise<void> {
  for (const policy of CLINIC_ACCESS_POLICIES) {
    try {
      await systemRepo.createResource<AccessPolicy>({
        ...policy,
        meta: { project: project.id },
      });
    } catch (err) {
      getLogger().warn('Failed to create default clinic access policy', {
        project: project.id,
        policy: policy.name,
        error: String(err),
      });
    }
  }
}
