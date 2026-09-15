import type { Patient } from '@medplum/fhirtypes';
import { CNI_SYSTEM, PASSPORT_SYSTEM, RESIDENCE_PERMIT_SYSTEM } from './constants';

/**
 * The minimum a Premier Health record needs before a clinician can rely on it.
 *
 * Deliberately demographics only. Allergies, medications and conditions are
 * collected by a nurse at the intro appointment rather than self-reported —
 * unverified clinical data sitting in a chart is worse than an empty one,
 * because it looks authoritative.
 */
export type OnboardingField = 'birthDate' | 'gender' | 'phone' | 'idDocument';

export const ONBOARDING_LABELS: Record<OnboardingField, string> = {
  birthDate: 'Date of birth',
  gender: 'Sex',
  phone: 'Mobile number',
  idDocument: 'Identity document',
};

/** Identity documents we accept. A patient need not be a Cameroonian national. */
export const ID_DOCUMENT_TYPES = [
  { key: 'cni', label: 'CNI (national ID)', system: CNI_SYSTEM },
  { key: 'passport', label: 'Passport', system: PASSPORT_SYSTEM },
  { key: 'residence', label: 'Residence permit', system: RESIDENCE_PERMIT_SYSTEM },
] as const;

export type IdDocumentKey = (typeof ID_DOCUMENT_TYPES)[number]['key'];

const ID_SYSTEMS: string[] = ID_DOCUMENT_TYPES.map((t) => t.system);

export interface OnboardingStatus {
  complete: boolean;
  missing: OnboardingField[];
  /** For a progress hint — "2 of 4". */
  done: number;
  total: number;
}

export function patientPhone(patient?: Patient): string | undefined {
  return patient?.telecom?.find((t) => t.system === 'phone' && t.value)?.value;
}

/**
 * Which parts of the basic profile are still missing.
 * @param patient - The patient to check.
 * @returns Completion state and the outstanding fields.
 */
export function onboardingStatus(patient?: Patient): OnboardingStatus {
  const missing: OnboardingField[] = [];
  if (!patient?.birthDate) {
    missing.push('birthDate');
  }
  if (!patient?.gender) {
    missing.push('gender');
  }
  if (!patientPhone(patient)) {
    missing.push('phone');
  }
  const hasId = patient?.identifier?.some((id) => id.value && ID_SYSTEMS.includes(id.system ?? ''));
  if (!hasId) {
    missing.push('idDocument');
  }
  const total = 4;
  return { complete: missing.length === 0, missing, done: total - missing.length, total };
}

/**
 * Applies the onboarding answers to a Patient, leaving everything else intact.
 *
 * Returns a NEW resource rather than mutating: the caller queues it through the
 * offline outbox, which may replay it later, and a mutated object shared with
 * the UI would drift from what actually gets sent.
 * @param patient - The patient being updated.
 * @param input - Collected values.
 * @returns The updated patient resource.
 */
export function applyOnboarding(
  patient: Patient,
  input: { birthDate?: string; gender?: Patient['gender']; phone?: string; idType?: IdDocumentKey; idNumber?: string }
): Patient {
  const next: Patient = { ...patient };

  if (input.birthDate) {
    next.birthDate = input.birthDate;
  }
  if (input.gender) {
    next.gender = input.gender;
  }

  if (input.phone) {
    const telecom = (patient.telecom ?? []).filter((t) => t.system !== 'phone');
    next.telecom = [...telecom, { system: 'phone', value: input.phone, use: 'mobile' }];
  }

  if (input.idType && input.idNumber) {
    const type = ID_DOCUMENT_TYPES.find((t) => t.key === input.idType);
    if (type) {
      // Replace any previous identity document so a corrected number does not
      // leave the old one behind, but keep the MRN and anything else.
      const others = (patient.identifier ?? []).filter((id) => !ID_SYSTEMS.includes(id.system ?? ''));
      next.identifier = [...others, { system: type.system, value: input.idNumber.trim(), type: { text: type.label } }];
    }
  }

  return next;
}
