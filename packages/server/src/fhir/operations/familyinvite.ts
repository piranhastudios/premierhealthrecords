// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Premier Health contributors
// SPDX-License-Identifier: Apache-2.0
//
// Family identity linking for Premier Health Cameroon.
//
//   - Patient/$invite-family-member (type-level): the holder (authenticated patient) mints an
//     opaque single-use invite token, stored as a Basic resource. Delivery of the claim deep
//     link to the contact is best-effort / out of scope here (see note below).
//   - Patient/$claim-family-invite (type-level, authenticated as the NEW user's Patient): the
//     claimant redeems the token, which links the two patients (holder.link seealso + a
//     RelatedPerson) and shares the holder's accounts with the claimant.
import { allOk, badRequest, createReference, OperationOutcomeError, Operator, preconditionFailed } from '@medplum/core';
import type { FhirRequest, FhirResponse } from '@medplum/fhir-router';
import type { Basic, OperationDefinition, ParametersParameter, Patient, Reference } from '@medplum/fhirtypes';
import { randomUUID } from 'node:crypto';
import { getAuthenticatedContext } from '../../context';
import { parseInputParameters } from './utils/parameters';

export const FAMILY_INVITE_SYSTEM = 'https://premierhealth.cm/fhir/sid/family-invite';
const FAMILY_INVITE_CODE_SYSTEM = 'https://premierhealth.cm/fhir/CodeSystem/basic-type';
// Extension URLs used to stash the invite's contact + claim state on the Basic resource.
const EXT_CONTACT = 'https://premierhealth.cm/fhir/StructureDefinition/family-invite-contact';
const EXT_NAME = 'https://premierhealth.cm/fhir/StructureDefinition/family-invite-name';
const EXT_CLAIMED = 'https://premierhealth.cm/fhir/StructureDefinition/family-invite-claimed';

// Invite tokens expire after 7 days (enforced at claim time against the stored `created` stamp).
const FAMILY_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Patient/$invite-family-member
// ---------------------------------------------------------------------------

const inviteOperation: OperationDefinition = {
  resourceType: 'OperationDefinition',
  id: 'patient-invite-family-member',
  url: 'https://premierhealth.cm/fhir/OperationDefinition/patient-invite-family-member',
  name: 'inviteFamilyMember',
  status: 'active',
  kind: 'operation',
  code: 'invite-family-member',
  resource: ['Patient'],
  system: false,
  type: true,
  instance: false,
  parameter: [
    {
      name: 'name',
      use: 'in',
      min: 1,
      max: '1',
      type: 'string',
      documentation: 'Display name of the invited family member.',
    },
    {
      name: 'contact',
      use: 'in',
      min: 1,
      max: '1',
      type: 'string',
      documentation: 'Phone or email to deliver the invite to.',
    },
    { name: 'token', use: 'out', min: 1, max: '1', type: 'string' },
  ],
};

interface InviteParameters {
  name: string;
  contact: string;
}

/**
 * Resolves the authenticated caller's Patient profile reference, or undefined if the caller is not
 * acting as a Patient.
 * @returns The Patient reference string (e.g. 'Patient/123') or undefined.
 */
function getCallerPatientRef(): string | undefined {
  const { profile } = getAuthenticatedContext();
  const ref = profile.reference;
  return ref?.startsWith('Patient/') ? ref : undefined;
}

/**
 * Handles Patient/$invite-family-member: the holder mints a single-use invite token recorded as a
 * Basic resource (subject = the holder, contact + name stashed in extensions). Actual delivery of
 * the claim deep link (`phc://claim/<token>`) to the contact is out of scope here — matching the
 * premierhealth outbound bot's Subscription criteria reliably is uncertain, so we only persist the
 * invite and return the token; an out-of-band channel can deliver it.
 * @param req - The FHIR request (type-level on Patient).
 * @returns Parameters with `token`.
 */
export async function patientInviteFamilyMemberHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();

  const holderRef = getCallerPatientRef();
  if (!holderRef) {
    return [badRequest('Caller must be authenticated as a Patient to invite a family member')];
  }

  const params = parseInputParameters<InviteParameters>(inviteOperation, req);
  if (!params.name || !params.contact) {
    return [badRequest('name and contact are required')];
  }

  const token = randomUUID();
  await ctx.repo.createResource<Basic>({
    resourceType: 'Basic',
    code: { coding: [{ system: FAMILY_INVITE_CODE_SYSTEM, code: 'family-invite' }] },
    subject: { reference: holderRef } as Reference<Patient>,
    created: new Date().toISOString(),
    identifier: [{ system: FAMILY_INVITE_SYSTEM, value: token }],
    extension: [
      { url: EXT_CONTACT, valueString: params.contact },
      { url: EXT_NAME, valueString: params.name },
    ],
  });

  // NOTE: delivery is intentionally out of scope. The deep link to send is `phc://claim/${token}`.
  const out: ParametersParameter[] = [{ name: 'token', valueString: token }];
  return [allOk, { resourceType: 'Parameters', parameter: out }];
}

// ---------------------------------------------------------------------------
// Patient/$claim-family-invite
// ---------------------------------------------------------------------------

const claimOperation: OperationDefinition = {
  resourceType: 'OperationDefinition',
  id: 'patient-claim-family-invite',
  url: 'https://premierhealth.cm/fhir/OperationDefinition/patient-claim-family-invite',
  name: 'claimFamilyInvite',
  status: 'active',
  kind: 'operation',
  code: 'claim-family-invite',
  resource: ['Patient'],
  system: false,
  type: true,
  instance: false,
  parameter: [
    { name: 'token', use: 'in', min: 1, max: '1', type: 'string', documentation: 'The invite token to redeem.' },
    { name: 'status', use: 'out', min: 1, max: '1', type: 'string' },
  ],
};

interface ClaimParameters {
  token: string;
}

/**
 * Handles Patient/$claim-family-invite: the claiming user (authenticated as their own Patient)
 * redeems a family invite. Rejects invites older than 7 days, atomically marks the invite used
 * (version-conditioned, so concurrent claims cannot both win), then links the two patients
 * (holder.link 'seealso' + a RelatedPerson on the holder) and shares the holder's accounts with
 * the claimant.
 * @param req - The FHIR request (type-level on Patient).
 * @returns Parameters with `status` ('claimed').
 */
export async function patientClaimFamilyInviteHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();

  const claimantRef = getCallerPatientRef();
  if (!claimantRef) {
    return [badRequest('Caller must be authenticated as a Patient to claim a family invite')];
  }

  const params = parseInputParameters<ClaimParameters>(claimOperation, req);
  if (!params.token) {
    return [badRequest('token is required')];
  }

  // Resolve the invite via the system repo: the holder's Basic is in a different access scope.
  const systemRepo = ctx.repo.getSystemRepo();
  const invite = await systemRepo.searchOne<Basic>({
    resourceType: 'Basic',
    filters: [{ code: 'identifier', operator: Operator.EQUALS, value: `${FAMILY_INVITE_SYSTEM}|${params.token}` }],
  });
  if (!invite) {
    return [badRequest('Invalid or expired invite')];
  }
  if (invite.extension?.some((e) => e.url === EXT_CLAIMED)) {
    return [badRequest('Invite already used')];
  }

  // Enforce the invite TTL against the stored creation timestamp.
  const createdMs = invite.created ? Date.parse(invite.created) : NaN;
  if (!Number.isFinite(createdMs) || Date.now() - createdMs > FAMILY_INVITE_TTL_MS) {
    return [badRequest('Invalid or expired invite')];
  }

  const holderRef = invite.subject?.reference;
  if (!holderRef?.startsWith('Patient/')) {
    return [badRequest('Invite is not linked to a holder')];
  }
  const [, holderId] = holderRef.split('/');
  const [, claimantId] = claimantRef.split('/');

  // Mark the invite claimed FIRST, with an optimistic-concurrency precondition on the version we
  // just read, so two concurrent claims cannot both succeed: the loser's `ifMatch` no longer
  // matches and it gets 'Invite already used' before any link/account writes happen.
  try {
    await systemRepo.updateResource<Basic>(
      {
        ...invite,
        extension: [...(invite.extension ?? []), { url: EXT_CLAIMED, valueDateTime: new Date().toISOString() }],
      },
      { ifMatch: invite.meta?.versionId }
    );
  } catch (err) {
    if (err instanceof OperationOutcomeError && err.outcome.id === preconditionFailed.id) {
      return [badRequest('Invite already used')];
    }
    throw err;
  }

  const holder = await systemRepo.readResource<Patient>('Patient', holderId);
  const claimant = await systemRepo.readResource<Patient>('Patient', claimantId);

  // 1. Link holder -> claimant with a 'seealso' link.
  const hasLink = holder.link?.some((l) => l.other?.reference === claimantRef && l.type === 'seealso');
  if (!hasLink) {
    await systemRepo.updateResource<Patient>({
      ...holder,
      link: [...(holder.link ?? []), { other: createReference(claimant), type: 'seealso' }],
    });
  }

  // 2. Create a RelatedPerson recording the family relationship (claimant related to the holder).
  await systemRepo.createResource({
    resourceType: 'RelatedPerson',
    patient: createReference(holder),
    relationship: [
      {
        coding: [
          { system: 'http://terminology.hl7.org/CodeSystem/v3-RoleCode', code: 'FAMMEMB', display: 'family member' },
        ],
      },
    ],
    name: claimant.name,
  });

  // 3. Share the holder's accounts with the claimant so they can see the shared family record.
  const holderAccounts = holder.meta?.accounts ?? [];
  if (holderAccounts.length > 0) {
    const existing = claimant.meta?.accounts ?? [];
    const merged = [...existing];
    for (const acct of holderAccounts) {
      if (!merged.some((a) => a.reference === acct.reference)) {
        merged.push(acct);
      }
    }
    if (merged.length !== existing.length) {
      await systemRepo.updateResource<Patient>({
        ...claimant,
        meta: { ...claimant.meta, accounts: merged, account: merged[0] },
      });
    }
  }

  const out: ParametersParameter[] = [{ name: 'status', valueString: 'claimed' }];
  return [allOk, { resourceType: 'Parameters', parameter: out }];
}
