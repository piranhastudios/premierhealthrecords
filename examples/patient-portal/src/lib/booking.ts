import type { MedplumClient } from '@medplum/core';

// PractitionerRole.code text seeded for nurses (scripts/seed-cameroon-sites.mjs).
export const NURSE_ROLE = 'Nurse';
export const NURSE_SPECIALTY = 'Nursing';
// SERVICE_LINES code for video consultations. The booking screen matches it
// against HealthcareService.type coding to preselect the service.
export const TELEHEALTH_SERVICE = 'telehealth';

/**
 * Where "Video visit with a nurse" lands: straight on the only nurse's booking
 * screen when there is exactly one, otherwise (zero, several, or the search
 * failed) the clinician search filtered to nurses.
 */
export async function nurseVideoHref(medplum: MedplumClient): Promise<string> {
  try {
    const roles = await medplum.searchResources('PractitionerRole', `role:text=${NURSE_ROLE}&active=true&_count=10`);
    const ids = Array.from(
      new Set(
        roles
          .map((role) => role.practitioner?.reference?.split('/')[1])
          .filter((id): id is string => Boolean(id))
      )
    );
    if (ids.length === 1) {
      return `/(tabs)/appointments/doctor/${ids[0]}?service=${TELEHEALTH_SERVICE}`;
    }
  } catch {
    // Fall through to the filtered search.
  }
  return `/(tabs)/appointments/search?specialty=${NURSE_SPECIALTY}&service=${TELEHEALTH_SERVICE}`;
}
