// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Premier Health contributors
// SPDX-License-Identifier: Apache-2.0
//
// Patient/$grant — a patient time-boxes a provider organization's access to their record.
//
// Creating the grant does two things:
//   1. Records a FHIR Consent (status active, scope patient-privacy, permit provision with a
//      bounded period and the organization as the actor). This is the auditable, queryable
//      authorization artefact and the source of truth for revocation.
//   2. Adds the organization to the patient's meta.accounts[] (propagated across the patient
//      compartment, reusing the $set-accounts machinery), so the granted org can actually read
//      the patient's resources until the grant expires.
//
// `revokeExpiredGrants` is the exact reverse (same compartment walk, removing the org). It runs:
//   - opportunistically for the target patient at the start of every $grant call, and
//   - globally via the super-admin POST /$revoke-expired-grants operation (cron it — see
//     docs/grants-maintenance.md).
import type { SearchRequest, WithId } from '@medplum/core';
import {
  allOk,
  append,
  badRequest,
  createReference,
  EMPTY,
  getReferenceString,
  Operator,
  parseSearchRequest,
} from '@medplum/core';
import type { FhirRequest, FhirResponse } from '@medplum/fhir-router';
import type {
  Consent,
  OperationDefinition,
  Organization,
  ParametersParameter,
  Patient,
  Reference,
} from '@medplum/fhirtypes';
import { requireSuperAdmin } from '../../admin/super';
import { getConfig } from '../../config/loader';
import { getAuthenticatedContext } from '../../context';
import type { Repository, SystemRepository } from '../repo';
import { searchPatientCompartment } from './patienteverything';
import { parseInputParameters } from './utils/parameters';

// Category that marks a Consent as a rotating-QR patient-driven access grant. Used by
// revokeExpiredGrants to find the grants it owns.
export const GRANT_CATEGORY_SYSTEM = 'https://premierhealth.cm/fhir/CodeSystem/consent-category';
export const GRANT_CATEGORY_CODE = 'qr-access-grant';

const operation: OperationDefinition = {
  resourceType: 'OperationDefinition',
  id: 'patient-grant',
  url: 'https://premierhealth.cm/fhir/OperationDefinition/patient-grant',
  name: 'grant',
  status: 'active',
  kind: 'operation',
  code: 'grant',
  resource: ['Patient'],
  system: false,
  type: false,
  instance: true,
  parameter: [
    {
      name: 'organization',
      use: 'in',
      min: 1,
      max: '1',
      type: 'Reference',
      documentation: 'The provider Organization being granted time-boxed access.',
    },
    {
      name: 'durationMinutes',
      use: 'in',
      min: 1,
      max: '1',
      type: 'integer',
      documentation: 'How long the grant remains active, in minutes.',
    },
    { name: 'consent', use: 'out', min: 1, max: '1', type: 'Reference' },
    { name: 'status', use: 'out', min: 1, max: '1', type: 'string' },
  ],
};

interface GrantParameters {
  organization: Reference;
  durationMinutes: number;
}

function grantCategory(): Consent['category'] {
  return [{ coding: [{ system: GRANT_CATEGORY_SYSTEM, code: GRANT_CATEGORY_CODE, display: 'QR access grant' }] }];
}

type AccountMode = 'add' | 'remove';

/**
 * Computes the new meta.accounts list after adding/removing the given account.
 * @param list - The current meta.accounts list (possibly undefined).
 * @param account - The account reference to add or remove.
 * @param mode - 'add' or 'remove'.
 * @returns The updated list, or undefined when no change is needed.
 */
function withAccount(list: Reference[] | undefined, account: Reference, mode: AccountMode): Reference[] | undefined {
  const has = list?.some((a) => a.reference === account.reference);
  if (mode === 'add') {
    return has ? undefined : append(list, account);
  }
  return has ? list?.filter((a) => a.reference !== account.reference) : undefined;
}

/**
 * Adds or removes an account reference on a Patient AND on every resource in the patient
 * compartment, using the system repository for the privileged writes. Mirrors the propagation in
 * `setResourceAccounts` (set-accounts.ts) but is callable by the patient themselves (no admin
 * gate), because the patient is consenting to share (or un-share) their own record. Revocation
 * ('remove') walks the exact same compartment resource set the grant walked, so nothing keeps a
 * stale meta.accounts entry.
 * @param repo - The repository used to enumerate the compartment (the patient's repo for $grant,
 *   the system repo for the expiry sweep).
 * @param patientId - The patient logical id.
 * @param account - The Organization reference to add or remove.
 * @param mode - 'add' or 'remove'.
 */
async function updatePatientCompartmentAccounts(
  repo: Repository,
  patientId: string,
  account: Reference,
  mode: AccountMode
): Promise<void> {
  const systemRepo = repo.getSystemRepo();
  const patient = await systemRepo.readResource<Patient>('Patient', patientId);
  const accounts = withAccount(patient.meta?.accounts, account, mode);
  if (mode === 'add' && !accounts) {
    return; // Already granted; nothing to propagate.
  }
  if (accounts) {
    await systemRepo.updateResource<Patient>({
      ...patient,
      meta: { ...patient.meta, accounts, account: accounts[0] },
    });
  }

  // Propagate the change to the rest of the compartment (capped, matching set-accounts).
  const search: Partial<SearchRequest> = { offset: 0, count: 1000 };
  const maxSearchOffset = getConfig().maxSearchOffset ?? Number.POSITIVE_INFINITY;
  while ((search.offset ?? 0) <= maxSearchOffset) {
    const bundle = await searchPatientCompartment(repo, patient, search);
    for (const entry of bundle.entry ?? EMPTY) {
      const resource = entry.resource;
      if (resource && resource.resourceType !== 'Patient') {
        const updated = withAccount(resource.meta?.accounts, account, mode);
        if (updated) {
          await systemRepo.updateResource({
            ...resource,
            meta: { ...resource.meta, accounts: updated, account: updated[0] },
          });
        }
      }
    }
    const nextLink = bundle.link?.find((l) => l.relation === 'next');
    if (nextLink?.url) {
      search.offset = parseSearchRequest(nextLink.url).offset;
    } else {
      break;
    }
  }
}

/**
 * Handles Patient/$grant: the patient grants a provider Organization time-boxed access to their
 * record. Creates an active Consent (patient-privacy, permit, bounded period) and adds the
 * organization to the patient's meta.accounts (propagated across the compartment).
 * @param req - The FHIR request (instance-level on Patient).
 * @returns Parameters with `consent` (Reference) and `status` ('active').
 */
export async function patientGrantHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const { id } = req.params;

  const params = parseInputParameters<GrantParameters>(operation, req);
  if (!params.organization?.reference) {
    return [badRequest('organization reference is required')];
  }
  if (!params.durationMinutes || params.durationMinutes <= 0) {
    return [badRequest('durationMinutes must be a positive integer')];
  }

  const patient = await ctx.repo.readResource<Patient>('Patient', id);

  // Opportunistic expiry cleanup: before minting a new grant, revoke any of this patient's
  // grants whose period has already elapsed (cheap patient-scoped search).
  await revokeExpiredGrants(ctx.repo.getSystemRepo(), id);

  const now = new Date();
  const end = new Date(now.getTime() + params.durationMinutes * 60_000);

  const consent = await ctx.repo.createResource<Consent>({
    resourceType: 'Consent',
    status: 'active',
    scope: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/consentscope',
          code: 'patient-privacy',
          display: 'Privacy Consent',
        },
      ],
    },
    category: grantCategory(),
    patient: createReference(patient),
    dateTime: now.toISOString(),
    organization: [params.organization as Reference<Organization>],
    provision: {
      type: 'permit',
      period: { start: now.toISOString(), end: end.toISOString() },
      actor: [
        {
          role: {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/v3-ParticipationType',
                code: 'CST',
                display: 'custodian',
              },
            ],
          },
          // Consent.provision.actor.reference accepts Organization among others.
          reference: params.organization as Reference<Organization>,
        },
      ],
    },
  });

  // Add the org to the patient's accounts (additive), propagated across the patient compartment.
  // The patient authorizes this; the privileged write is performed by the system repo. This
  // mirrors $set-accounts' propagation but without its project-admin gate, since the actor here
  // is the patient consenting to share their own record.
  await updatePatientCompartmentAccounts(ctx.repo, id, params.organization, 'add');

  const out: ParametersParameter[] = [
    { name: 'consent', valueReference: { reference: getReferenceString(consent) } },
    { name: 'status', valueString: 'active' },
  ];
  return [allOk, { resourceType: 'Parameters', parameter: out }];
}

/**
 * Revokes a single QR access grant: removes the granted Organization from the patient's
 * meta.accounts across the ENTIRE patient compartment (the exact reverse of $grant's propagation),
 * then flips the Consent to status 'inactive' for audit.
 * @param systemRepo - A system repository with elevated privileges.
 * @param consent - The expired, still-active grant Consent.
 */
async function revokeGrant(systemRepo: SystemRepository, consent: WithId<Consent>): Promise<void> {
  const patientRef = consent.patient?.reference;
  const orgRef = consent.provision?.actor?.[0]?.reference;
  if (patientRef && orgRef?.reference) {
    const [, patientId] = patientRef.split('/');
    try {
      await updatePatientCompartmentAccounts(systemRepo, patientId, orgRef, 'remove');
    } catch {
      // Patient may have been deleted; still deactivate the Consent below.
    }
  }
  await systemRepo.updateResource<Consent>({ ...consent, status: 'inactive' });
}

/**
 * Revokes every QR access grant whose bounded period has elapsed (optionally scoped to a single
 * patient). Invoked opportunistically at the start of $grant (patient-scoped) and globally by the
 * super-admin POST /$revoke-expired-grants operation, which should be cron'd — see
 * docs/grants-maintenance.md.
 * @param systemRepo - A system repository with elevated privileges.
 * @param patientId - Optional patient logical id to scope the sweep to.
 * @returns The number of grants revoked.
 */
export async function revokeExpiredGrants(systemRepo: SystemRepository, patientId?: string): Promise<number> {
  const nowIso = new Date().toISOString();
  const filters = [
    { code: 'status', operator: Operator.EQUALS, value: 'active' },
    { code: 'category', operator: Operator.EQUALS, value: `${GRANT_CATEGORY_SYSTEM}|${GRANT_CATEGORY_CODE}` },
    { code: 'period', operator: Operator.ENDS_BEFORE, value: nowIso },
  ];
  if (patientId) {
    filters.push({ code: 'patient', operator: Operator.EQUALS, value: `Patient/${patientId}` });
  }
  const expired = await systemRepo.searchResources<Consent>({ resourceType: 'Consent', filters });

  for (const consent of expired) {
    await revokeGrant(systemRepo, consent);
  }
  return expired.length;
}

/**
 * Handles POST /$revoke-expired-grants (system-level, super-admin only): global sweep that revokes
 * every expired QR access grant. Intended to be invoked periodically from an ops cron — see
 * docs/grants-maintenance.md.
 * @param _req - The FHIR request (no input parameters).
 * @returns Parameters with `revoked` (integer count).
 */
export async function revokeExpiredGrantsHandler(_req: FhirRequest): Promise<FhirResponse> {
  const ctx = requireSuperAdmin();
  const revoked = await revokeExpiredGrants(ctx.repo.getSystemRepo());
  return [allOk, { resourceType: 'Parameters', parameter: [{ name: 'revoked', valueInteger: revoked }] }];
}
