// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { AccessPolicy } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { useMemo } from 'react';

export type ProviderRole = 'admin' | 'clinician' | 'nurse' | 'front-desk';

export interface UserRole {
  /** Coarse role label, used for greetings and picking a dashboard preset. */
  role: ProviderRole;
  /** True for project or super admins. */
  isAdmin: boolean;
  /** Fine-grained capability flags derived from the compiled access policy. */
  can: {
    /** Write access to Observation (record vitals / clinical readings). */
    recordVitals: boolean;
    /** Write access to Appointment (booking / scheduling). */
    schedule: boolean;
    /** Write access to Patient (register / edit demographics). */
    registerPatients: boolean;
    /** Write access to Invoice / ChargeItem (collect payments). */
    manageBilling: boolean;
  };
}

/**
 * Returns true if the compiled access policy grants create/update access to the
 * given resource type. Admins (no scoped policy) short-circuit to true elsewhere.
 * @param policy - The compiled access policy, or undefined for unscoped users.
 * @param resourceType - The FHIR resource type to test for write access.
 * @returns True if the policy grants create/update for the resource type.
 */
function canWrite(policy: AccessPolicy | undefined, resourceType: string): boolean {
  const entries = policy?.resource?.filter((r) => r.resourceType === resourceType || r.resourceType === '*') ?? [];
  return entries.some((entry) => {
    if (entry.readonly === true) {
      return false;
    }
    // Newer policies express permissions via `interaction`; when present it must
    // include a write verb. When absent (legacy `readonly` style), an entry with
    // no `readonly` flag means full access.
    if (entry.interaction) {
      return entry.interaction.some((i) => i === 'update' || i === 'create');
    }
    return true;
  });
}

/**
 * Determines the current user's role and capabilities for driving the
 * role-based dashboard.
 *
 * The `/auth/me` session strips `accessPolicy` off the ProjectMembership, so we
 * rely on two client-side signals that are always available after login:
 *  - `medplum.isProjectAdmin()` / `isSuperAdmin()` for the admin role, and
 *  - `medplum.getAccessPolicy()` (the compiled effective policy) whose
 *    `resource[]` readonly flags fingerprint the nurse vs front-desk vs
 *    unscoped-clinician roles.
 *
 * @returns The role label plus granular capability flags.
 */
export function useUserRole(): UserRole {
  const medplum = useMedplum();
  const isAdmin = medplum.isProjectAdmin() || medplum.isSuperAdmin();
  const policy = medplum.getAccessPolicy();

  return useMemo(() => {
    // Admins and unscoped users have full access to everything.
    const unscoped = isAdmin || policy === undefined;

    const can = {
      recordVitals: unscoped || canWrite(policy, 'Observation'),
      schedule: unscoped || canWrite(policy, 'Appointment'),
      registerPatients: unscoped || canWrite(policy, 'Patient'),
      manageBilling: unscoped || canWrite(policy, 'Invoice') || canWrite(policy, 'ChargeItem'),
    };

    let role: ProviderRole;
    if (isAdmin) {
      role = 'admin';
    } else if (policy === undefined) {
      role = 'clinician';
    } else if (can.recordVitals && !can.schedule) {
      role = 'nurse';
    } else if (can.schedule && !can.recordVitals) {
      role = 'front-desk';
    } else {
      role = 'clinician';
    }

    return { role, isAdmin, can };
    // `policy` identity is stable for a given login session.
  }, [isAdmin, policy]);
}

/**
 * Human-friendly label for a role, e.g. for greetings and badges.
 * @param role - The provider role.
 * @returns The display label for the role.
 */
export function roleLabel(role: ProviderRole): string {
  switch (role) {
    case 'admin':
      return 'Administrator';
    case 'nurse':
      return 'Nurse';
    case 'front-desk':
      return 'Front Desk';
    case 'clinician':
    default:
      return 'Clinician';
  }
}
