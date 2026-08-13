// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient, WithId } from '@medplum/core';
import type { Consent, Patient } from '@medplum/fhirtypes';
import type { ConsentScope } from '../constants';
import { CONSENT_SCOPE_SYSTEM, PATIENT_TAG_SUPPRESSED, PATIENT_TAG_SYSTEM } from '../constants';

/**
 * Consent policy:
 * - `marketing`: EXPLICIT opt-in required — the newest active marketing Consent
 *   must be a permit. No consent on file = no marketing send.
 * - `care-communication`: allowed unless the newest active consent for the
 *   scope is a deny (legitimate-interest basis for transactional messages).
 */

/**
 * The newest active Consent for a scope, if any.
 * @param medplum - The Medplum client.
 * @param patientRef - `Patient/{id}`.
 * @param scope - The consent scope.
 * @returns The newest active Consent, or undefined.
 */
export async function getLatestConsent(
  medplum: MedplumClient,
  patientRef: string,
  scope: ConsentScope
): Promise<WithId<Consent> | undefined> {
  return medplum.searchOne('Consent', [
    ['patient', patientRef],
    ['category', `${CONSENT_SCOPE_SYSTEM}|${scope}`],
    ['status', 'active'],
    ['_sort', '-_lastUpdated'],
  ]);
}

/**
 * Whether a send with the given consent scope is permitted for the patient.
 * @param medplum - The Medplum client.
 * @param patientRef - `Patient/{id}`.
 * @param scope - The send node's consent scope.
 * @returns True when the send may proceed.
 */
export async function isSendPermitted(medplum: MedplumClient, patientRef: string, scope: ConsentScope): Promise<boolean> {
  const consent = await getLatestConsent(medplum, patientRef, scope);
  if (scope === 'marketing') {
    return consent?.provision?.type === 'permit';
  }
  return consent?.provision?.type !== 'deny';
}

/**
 * Writes a deny Consent for a scope (revocation / suppression).
 * @param medplum - The Medplum client.
 * @param patientRef - `Patient/{id}`.
 * @param scope - The scope being revoked.
 * @param reason - Free-text policy rationale recorded on the Consent.
 * @returns The created Consent.
 */
export async function revokeConsent(
  medplum: MedplumClient,
  patientRef: string,
  scope: ConsentScope,
  reason: string
): Promise<WithId<Consent>> {
  return medplum.createResource<Consent>({
    resourceType: 'Consent',
    status: 'active',
    scope: {
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/consentscope', code: 'patient-privacy' }],
    },
    category: [{ coding: [{ system: CONSENT_SCOPE_SYSTEM, code: scope }] }],
    patient: { reference: patientRef },
    dateTime: new Date().toISOString(),
    policyRule: { text: reason },
    provision: { type: 'deny' },
  });
}

/**
 * Writes a permit Consent for a scope (opt-in).
 * @param medplum - The Medplum client.
 * @param patientRef - `Patient/{id}`.
 * @param scope - The scope being granted.
 * @returns The created Consent.
 */
export async function grantConsent(
  medplum: MedplumClient,
  patientRef: string,
  scope: ConsentScope
): Promise<WithId<Consent>> {
  return medplum.createResource<Consent>({
    resourceType: 'Consent',
    status: 'active',
    scope: {
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/consentscope', code: 'patient-privacy' }],
    },
    category: [{ coding: [{ system: CONSENT_SCOPE_SYSTEM, code: scope }] }],
    patient: { reference: patientRef },
    dateTime: new Date().toISOString(),
    // FHIR invariant ppc-1 requires a policy or policyRule.
    policyRule: { text: 'Patient opt-in' },
    provision: { type: 'permit' },
  });
}

/**
 * True when the patient carries the email-suppressed tag (bounce/complaint).
 * @param patient - The patient to test.
 * @returns True when suppressed.
 */
export function isSuppressed(patient: Patient): boolean {
  return Boolean(patient.meta?.tag?.some((t) => t.system === PATIENT_TAG_SYSTEM && t.code === PATIENT_TAG_SUPPRESSED));
}

/**
 * Adds the email-suppressed tag to a patient (idempotent).
 * @param medplum - The Medplum client.
 * @param patient - The patient to tag.
 * @returns The updated patient (or the input when already tagged).
 */
export async function suppressPatient(medplum: MedplumClient, patient: WithId<Patient>): Promise<WithId<Patient>> {
  if (isSuppressed(patient)) {
    return patient;
  }
  return medplum.updateResource<Patient>({
    ...patient,
    meta: {
      ...patient.meta,
      tag: [
        ...(patient.meta?.tag ?? []),
        { system: PATIENT_TAG_SYSTEM, code: PATIENT_TAG_SUPPRESSED, display: 'Email suppressed' },
      ],
    },
  });
}
