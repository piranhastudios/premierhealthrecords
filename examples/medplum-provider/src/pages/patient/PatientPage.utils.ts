// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { AccessPolicy, Patient, ProjectMembership } from '@medplum/fhirtypes';
import { hasDoseSpotIdentifier, hasScriptSureIdentifier } from '../../components/utils';
import { canReadResource } from '../../hooks/useUserRole';

export function patientPathPrefix(patientId: string): string {
  return `/Patient/${patientId}`;
}

export function prependPatientPath(patient: Patient | undefined, path: string): string {
  if (patient?.id) {
    return `${patientPathPrefix(patient.id)}${!path.startsWith('/') ? '/' : ''}${path}`;
  }

  return path;
}

export function formatPatientPageTabUrl(patientId: string, tab: PatientPageTabInfo): string {
  return `${patientPathPrefix(patientId)}/${tab.url.replace('%patient.id', patientId)}`;
}

export type PatientPageTabInfo = {
  id: string;
  url: string;
  label: string;
};

/**
 * Returns the human-friendly tab label for a resource type shown in the patient
 * chart's generic search tabs, e.g. `Encounter` -> "Visits".
 *
 * @param resourceType - The FHIR resource type being listed.
 * @returns The matching tab label, or the resource type when it has no tab.
 */
export function tableTabLabel(resourceType: string): string {
  return PatientPageTabs.find((tab) => tab.url.split('?')[0] === resourceType)?.label ?? resourceType;
}

export function getPatientPageTabOrThrow(tabId: string): PatientPageTabInfo {
  const result = PatientPageTabs.find((tab) => tab.id === tabId);

  if (!result) {
    throw new Error(`Could not find patient page tab with id ${tabId}`);
  }
  return result;
}

/**
 * Returns the patient page tabs filtered based on user permissions.
 * Filters out e-prescribing tabs if the user doesn't have the corresponding integration access.
 *
 * @param membership - The current user's project membership.
 * @param options - Optional overrides for tab visibility checks.
 * @param options.hasDoseSpotAccess - When provided, controls DoseSpot tab visibility directly
 *   (supports self-enrollment via PractitionerRole in addition to existing identifiers).
 *   When omitted, falls back to checking the membership for a DoseSpot identifier.
 * @returns Filtered array of patient page tabs.
 */
/**
 * The resource type a tab reads. A user whose access policy cannot read it only
 * gets "Forbidden" errors from the tab, so it is hidden instead.
 */
const TAB_READ_REQUIREMENTS: Record<string, string> = {
  encounter: 'Encounter',
  tasks: 'Task',
  meds: 'MedicationRequest',
  labs: 'ServiceRequest',
  devices: 'Device',
  documentreference: 'DocumentReference',
  careplan: 'CarePlan',
  message: 'Communication',
  payments: 'Invoice',
};

export function getPatientPageTabs(
  membership: ProjectMembership | undefined,
  options?: { hasDoseSpotAccess?: boolean; policy?: AccessPolicy }
): PatientPageTabInfo[] {
  const hasDoseSpot = options?.hasDoseSpotAccess ?? hasDoseSpotIdentifier(membership);
  const hasScriptSure = hasScriptSureIdentifier(membership);
  return PatientPageTabs.filter((tab) => {
    if (tab.id === 'dosespot') {
      return hasDoseSpot;
    }
    if (tab.id === 'scriptsure') {
      return hasScriptSure;
    }
    const requiredType = TAB_READ_REQUIREMENTS[tab.id];
    if (requiredType) {
      return canReadResource(options?.policy, requiredType);
    }
    return true;
  });
}

export const PatientPageTabs: PatientPageTabInfo[] = [
  // The chart landing page. The activity timeline is reachable from every tab
  // via the drawer in `PatientPage`, so it is not a tab of its own.
  { id: 'overview', url: '', label: 'Overview' },
  { id: 'edit', url: 'edit', label: 'Edit' },
  // NOTE on the table tab URLs below: keep them in the canonical form produced by
  // `formatSearchQuery` (params sorted, `_count` present, `_offset=0` omitted) —
  // `PatientSearchPage` compares `location.search` against it and re-navigates on a
  // mismatch, so a non-canonical URL costs an extra navigation on every tab click.
  //
  // `_sort` is validated server-side and case-sensitively, and the server emits no
  // NULLS LAST, so `-_lastUpdated` is the only safe sort here: `-period`/`-authoredOn`
  // are not valid search parameter codes, and `-date` would float records that never
  // got a date to the top.
  {
    id: 'encounter',
    url: 'Encounter?_count=20&_fields=class,period,status,practitioner,_lastUpdated&_sort=-_lastUpdated&patient=%patient.id',
    label: 'Visits',
  },
  {
    id: 'tasks',
    url: 'Task',
    label: 'Tasks',
  },
  {
    id: 'meds',
    url: 'MedicationRequest?_count=20&_fields=medication[x],status,authoredOn,requester,_lastUpdated&_sort=-_lastUpdated&patient=%patient.id',
    label: 'Meds',
  },
  { id: 'dosespot', url: 'dosespot', label: 'DoseSpot' },
  { id: 'scriptsure', url: 'scriptsure', label: 'ScriptSure' },
  {
    id: 'labs',
    url: 'ServiceRequest',
    label: 'Labs',
  },
  {
    // `device-name` is the search parameter, not the `deviceName` element: the element is
    // a BackboneElement array and renders as a nested definition list inside the cell.
    id: 'devices',
    url: 'Device?_count=20&_fields=device-name,manufacturer,modelNumber,serialNumber,status&_sort=-_lastUpdated&patient=%patient.id',
    label: 'Devices',
  },
  {
    // Previously had neither `_fields` (so it fell back to `_id,_lastUpdated`, a table of
    // raw UUIDs) nor `_sort` (so row order and paging were non-deterministic).
    id: 'documentreference',
    url: 'DocumentReference?_count=20&_fields=_lastUpdated,type,author,contenttype,status&_sort=-_lastUpdated&patient=%patient.id',
    label: 'Documents',
  },
  {
    id: 'careplan',
    url: 'CarePlan?_count=20&_fields=title,category,status,period,_lastUpdated&_sort=-_lastUpdated&patient=%patient.id',
    label: 'Care Plans',
  },
  { id: 'message', url: 'Communication', label: 'Messages' },
  { id: 'payments', url: 'payments', label: 'Payments' },
  { id: 'export', url: 'export', label: 'Export' },
];
